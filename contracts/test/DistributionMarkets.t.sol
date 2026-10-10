// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {DistributionMarkets} from '../src/DistributionMarkets.sol';
import {GaussianMath} from '../src/GaussianMath.sol';
import {MockUSDC} from './MockUSDC.sol';

interface TestVm {
    function warp(uint256 timestamp) external;
    function prank(address caller) external;
    function expectRevert(bytes4 selector) external;
}

/// @dev Uses Arc forge's runtime and built-in fuzzing without a test-framework dependency.
contract DistributionMarketsTest {
    TestVm private constant vm = TestVm(address(uint160(uint256(keccak256('hevm cheat code')))));
    address private constant ALICE = address(0xA11CE);
    address private constant BOB = address(0xB0B);
    uint256 private constant B = 10e6;
    MockUSDC private token;
    DistributionMarkets private markets;

    function setUp() public {
        vm.warp(100);
        token = new MockUSDC();
        markets = new DistributionMarkets(address(token), address(this));
        token.mint(address(this), 100000e6);
        token.mint(ALICE, 100000e6);
        token.mint(BOB, 100000e6);
        token.approve(address(markets), 100000e6);
        vm.prank(ALICE); token.approve(address(markets), 100000e6);
        vm.prank(BOB); token.approve(address(markets), 100000e6);
    }

    function config() private view returns (DistributionMarkets.MarketConfig memory c) {
        c.resolver = address(this); c.rulesHash = keccak256('committed rules');
        c.rulesURI = 'https://example.test/immutable-rules.json'; c.units = 'normalized units';
        c.scale = 1e18; c.outcomeStep = 1e12; c.backing = B; c.k = 10e18;
        c.minMean = -1000e18; c.maxMean = 1000e18;
        c.minSigma = 1e18; c.maxSigma = 100e18;
        c.minOutcome = -1000e18; c.maxOutcome = 1000e18;
        c.closeAt = uint64(block.timestamp + 1000); c.resolveBy = c.closeAt + 1000;
    }

    function testFuzz_LifecycleConservation(uint256 seed, uint8 count) public {
        DistributionMarkets.MarketConfig memory c = config();
        DistributionMarkets.Curve memory oldCurve = DistributionMarkets.Curve(0, 1e18);
        uint256 id = markets.createMarket(c, oldCurve);
        uint256 length = uint256(count) % 8 + 1;
        uint256[] memory ids = new uint256[](length);
        for (uint256 i; i < length; ++i) {
            seed = uint256(keccak256(abi.encode(seed, i)));
            DistributionMarkets.Curve memory next = DistributionMarkets.Curve(int256(seed % 21) * 1e18 - 10e18, ((seed >> 8) % 99 + 1) * 1e18);
            if (next.mean == oldCurve.mean && next.sigma == oldCurve.sigma) next.mean += 1e18;
            vm.prank(i % 2 == 0 ? ALICE : BOB);
            ids[i] = markets.trade(id, next, i, B, c.closeAt - 1);
            oldCurve = next;
        }
        vm.warp(c.closeAt);
        markets.resolve(id, int256(seed % 21) * 1e18 - 10e18, keccak256('retained evidence'));
        uint256 total = markets.previewSponsorClaim(id);
        for (uint256 i; i < length; ++i) {
            uint256 payout = markets.previewClaim(ids[i]);
            require(payout <= 2 * B, 'Payout exceeds conservative bound');
            total += payout;
        }
        require(total == (length + 1) * B, 'Integer claims do not telescope');
        if ((seed & 1) == 0) markets.claimSponsor(id);
        // Arbitrary order: choose and remove one random unclaimed receipt each iteration.
        for (uint256 remaining = length; remaining > 0; --remaining) {
            seed = uint256(keccak256(abi.encode(seed, remaining)));
            uint256 index = seed % remaining;
            uint256 receiptId = ids[index];
            DistributionMarkets.Receipt memory receipt = markets.getReceipt(receiptId);
            vm.prank(receipt.owner); markets.claim(receiptId);
            ids[index] = ids[remaining - 1];
        }
        if (!markets.getMarket(id).sponsorClaimed) markets.claimSponsor(id);
        require(markets.totalLiability() == 0, 'Outstanding liability remains');
        require(token.balanceOf(address(markets)) == 0, 'Escrow remains');
        DistributionMarkets.Market memory market = markets.getMarket(id);
        require(market.deposited == market.paid, 'Market collateral mismatch');
    }

    function testFuzz_CancellationRefunds(uint256 seed) public {
        DistributionMarkets.MarketConfig memory c = config();
        uint256 id = markets.createMarket(c, DistributionMarkets.Curve(0, 1e18));
        uint256 aliceBefore = token.balanceOf(ALICE);
        vm.prank(ALICE);
        uint256 receiptId = markets.trade(id, DistributionMarkets.Curve(int256(seed % 100 + 1) * 1e18, 2e18), 0, B, c.closeAt - 1);
        vm.warp(c.resolveBy);
        vm.prank(BOB); markets.cancelExpired(id);
        require(markets.previewClaim(receiptId) == B, 'Refund must equal original deposit');
        vm.prank(ALICE); markets.claim(receiptId);
        markets.claimSponsor(id);
        require(token.balanceOf(ALICE) == aliceBefore, 'Cancellation has nonzero P&L');
        require(markets.totalLiability() == 0, 'Refund liability remains');
    }

    function testFuzz_EvaluatorAlwaysBounded(int256 mean, int256 x, uint256 sigmaSeed) public pure {
        mean %= 1000e18; x %= 1000e18;
        GaussianMath.Curve memory curve = GaussianMath.Curve(mean, (sigmaSeed % 100 + 1) * 1e18);
        require(GaussianMath.evaluate(curve, 10e18, B, x) <= B, 'Evaluator outside backing');
    }

    function testNormalizationTiesAndAlignedBounds() public {
        DistributionMarkets.MarketConfig memory c = config(); c.scale = 2e18; c.outcomeStep = 1;
        uint256 id = markets.createMarket(c, DistributionMarkets.Curve(0, 1e18));
        require(markets.normalizeOutcome(id, 1) == 1, 'Positive tie must round away from zero');
        require(markets.normalizeOutcome(id, -1) == -1, 'Negative tie must round away from zero');
        c.minOutcome = 1; c.maxOutcome = 1e18 - 1; c.outcomeStep = 1e18;
        vm.expectRevert(DistributionMarkets.InvalidConfiguration.selector);
        markets.createMarket(c, DistributionMarkets.Curve(0, 1e18));
    }

    function testTransferFailurePreservesClaim() public {
        DistributionMarkets.MarketConfig memory c = config();
        uint256 id = markets.createMarket(c, DistributionMarkets.Curve(0, 1e18));
        vm.prank(ALICE);
        uint256 receiptId = markets.trade(id, DistributionMarkets.Curve(1e18, 2e18), 0, B, c.closeAt - 1);
        vm.warp(c.closeAt); markets.resolve(id, 0, keccak256('evidence'));
        token.setFailTransfers(true);
        vm.prank(ALICE);
        (bool succeeded,) = address(markets).call(abi.encodeCall(markets.claim, receiptId));
        require(!succeeded && !markets.getReceipt(receiptId).claimed, 'Failure destroyed claim');
        token.setFailTransfers(false);
        vm.prank(ALICE); markets.claim(receiptId);
    }
}
