// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {DistributionMarkets} from "../src/DistributionMarkets.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

interface ArcTestVm {
    struct Log { bytes32[] topics; bytes data; address emitter; }
    function deal(address account, uint256 newBalance) external;
    function prank(address caller) external;
    function warp(uint256 timestamp) external;
    function recordLogs() external;
    function getRecordedLogs() external returns (Log[] memory);
}

interface ArcNativeFiatToken is IERC20Metadata {
    function blacklister() external view returns (address);
    function blacklist(address account) external;
    function unBlacklist(address account) external;
}

/// @dev Run on Arc's runtime, forked from the disposable local Arc node.
/// These tests use the real predeploy and precompile, not an ERC20 mock.
contract ArcRuntimeTest {
    ArcTestVm private constant vm = ArcTestVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    ArcNativeFiatToken private constant usdc = ArcNativeFiatToken(0x3600000000000000000000000000000000000000);
    address private constant ALICE = address(0xA11CE);
    address private constant BOB = address(0xB0B);
    uint256 private constant BACKING = 10e6;
    DistributionMarkets private markets;

    function setUp() public {
        require(address(usdc).code.length > 0, "Fork the local Arc node to load native USDC");
        vm.deal(address(this), 1000e18);
        vm.deal(ALICE, 1000e18);
        vm.deal(BOB, 1000e18);
        markets = new DistributionMarkets(address(usdc), address(this));
    }

    function config() private view returns (DistributionMarkets.MarketConfig memory c) {
        c.resolver = address(this);
        c.rulesHash = keccak256("local native-USDC rules");
        c.rulesURI = "https://example.test/committed-native-rules.json";
        c.units = "normalized units";
        c.scale = 1e18;
        c.outcomeStep = 1e12;
        c.backing = BACKING;
        c.k = 10e18;
        c.minMean = -1000e18;
        c.maxMean = 1000e18;
        c.minSigma = 1e18;
        c.maxSigma = 100e18;
        c.minOutcome = -1000e18;
        c.maxOutcome = 1000e18;
        c.closeAt = uint64(block.timestamp + 1000);
        c.resolveBy = c.closeAt + 1000;
    }

    function create() private returns (uint256 id, DistributionMarkets.MarketConfig memory c) {
        c = config();
        usdc.approve(address(markets), BACKING);
        id = markets.createMarket(c, DistributionMarkets.Curve(0, 1e18));
        require(usdc.allowance(address(this), address(markets)) == 0, "Exact sponsor allowance not consumed");
    }

    function trade(uint256 id, address owner, uint256 nonce, int256 mean) private returns (uint256 receiptId) {
        vm.prank(owner); usdc.approve(address(markets), BACKING);
        vm.prank(owner);
        receiptId = markets.trade(id, DistributionMarkets.Curve(mean, 2e18), nonce, BACKING, block.timestamp + 500);
        require(usdc.allowance(owner, address(markets)) == 0, "Exact trader allowance not consumed");
    }

    function testNativeERC20ViewsShareBalanceAndDust() public {
        vm.deal(ALICE, 123e18 + 987_654_321);
        require(usdc.decimals() == 6, "Wrong ERC20 decimals");
        require(usdc.balanceOf(ALICE) == 123e6, "Native dust must floor in ERC20 view");
        require(ALICE.balance / 1e12 == usdc.balanceOf(ALICE), "Balance views disagree");
        uint256 recipientBefore = BOB.balance;
        vm.prank(ALICE); usdc.transfer(BOB, 100_000);
        require(BOB.balance - recipientBefore == 100_000 * 1e12, "Wrong six/eighteen conversion");
        require(ALICE.balance == 122_900_000_000_987_654_321, "Dust must remain native");
    }

    function testERC20TransferEmitsBothPrecisionStreams() public {
        vm.recordLogs();
        vm.prank(ALICE); usdc.transfer(BOB, 100_000);
        ArcTestVm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 signature = keccak256("Transfer(address,address,uint256)");
        bool foundNative;
        bool foundToken;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics.length == 0 || logs[i].topics[0] != signature) continue;
            if (logs[i].emitter == address(type(uint160).max - 1)) {
                require(abi.decode(logs[i].data, (uint256)) == 100_000 * 1e12, "Wrong native log precision");
                foundNative = true;
            }
            if (logs[i].emitter == address(usdc)) {
                require(abi.decode(logs[i].data, (uint256)) == 100_000, "Wrong token log precision");
                foundToken = true;
            }
        }
        require(foundNative && foundToken, "Arc dual transfer streams missing");
    }

    function testZeroAddressValueTransfersRevert() public {
        (bool nativeSucceeded,) = payable(address(0)).call{value: 1}("");
        require(!nativeSucceeded, "Native zero-address burn must revert");
        vm.prank(ALICE);
        (bool tokenSucceeded,) = address(usdc).call(abi.encodeCall(usdc.transfer, (address(0), 1)));
        require(!tokenSucceeded, "ERC20 zero-address transfer must revert");
    }

    function testNativeUSDCResolvedEscrowAndCrossMarketRefunds() public {
        (uint256 resolvedId, DistributionMarkets.MarketConfig memory c) = create();
        uint256 aliceReceipt = trade(resolvedId, ALICE, 0, 1e18);
        uint256 bobReceipt = trade(resolvedId, BOB, 1, -1e18);
        (uint256 cancelledId, DistributionMarkets.MarketConfig memory second) = create();
        uint256 refundReceipt = trade(cancelledId, ALICE, 0, 2e18);
        require(markets.totalLiability() == 5 * BACKING, "Native deposits mismatch");
        require(address(markets).balance == 5 * BACKING * 1e12, "Native escrow mismatch");
        vm.warp(c.closeAt);
        markets.resolve(resolvedId, 0, keccak256("retained observation"));
        uint256 traderTotal = markets.previewClaim(aliceReceipt) + markets.previewClaim(bobReceipt);
        require(traderTotal + markets.previewSponsorClaim(resolvedId) == 3 * BACKING, "Native claims do not conserve");
        vm.prank(BOB); markets.claim(bobReceipt);
        markets.claimSponsor(resolvedId);
        vm.prank(ALICE); markets.claim(aliceReceipt);
        require(markets.totalLiability() == 2 * BACKING, "Another market's liabilities changed");
        require(usdc.balanceOf(address(markets)) == 2 * BACKING, "Another market's native escrow changed");
        vm.warp(second.resolveBy);
        vm.prank(BOB); markets.cancelExpired(cancelledId);
        uint256 beforeRefund = ALICE.balance;
        vm.prank(ALICE); markets.claim(refundReceipt);
        require(ALICE.balance - beforeRefund == BACKING * 1e12, "Refund conversion mismatch");
        markets.claimSponsor(cancelledId);
        require(markets.totalLiability() == 0 && address(markets).balance == 0, "Native liabilities remain");
        require(markets.getMarket(resolvedId).deposited == markets.getMarket(resolvedId).paid, "Resolved accounting mismatch");
        require(markets.getMarket(cancelledId).deposited == markets.getMarket(cancelledId).paid, "Cancelled accounting mismatch");
    }

    function testArcBlocklistFailurePreservesClaimThenRecovers() public {
        (uint256 id, DistributionMarkets.MarketConfig memory c) = create();
        uint256 receiptId = trade(id, ALICE, 0, 1e18);
        vm.warp(c.closeAt);
        markets.resolve(id, 0, keccak256("observed evidence"));
        uint256 liabilityBefore = markets.totalLiability();
        uint256 escrowBefore = address(markets).balance;
        address blacklister = usdc.blacklister();
        require(blacklister != address(0), "Local Arc blacklister missing");
        vm.prank(blacklister); usdc.blacklist(ALICE);
        vm.prank(ALICE);
        (bool succeeded,) = address(markets).call(abi.encodeCall(markets.claim, (receiptId)));
        require(!succeeded, "Blocklisted claim transfer must fail");
        require(!markets.getReceipt(receiptId).claimed, "Failure destroyed receipt claim");
        require(markets.totalLiability() == liabilityBefore && address(markets).balance == escrowBefore, "Failure changed escrow accounting");
        vm.prank(blacklister); usdc.unBlacklist(ALICE);
        vm.prank(ALICE); markets.claim(receiptId);
        markets.claimSponsor(id);
        require(markets.totalLiability() == 0, "Unblocked recovery failed");
    }
}
