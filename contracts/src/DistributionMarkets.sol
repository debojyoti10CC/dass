// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20Metadata} from '@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol';
import {SafeERC20} from '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import {ReentrancyGuard} from '@openzeppelin/contracts/utils/ReentrancyGuard.sol';
import {GaussianMath} from './GaussianMath.sol';

/// @notice Non-upgradeable, individually claimable Gaussian distribution markets.
/// @dev Market escrow is tracked separately. Direct donations never create backing.
contract DistributionMarkets is ReentrancyGuard {
    using SafeERC20 for IERC20Metadata;

    enum Status { Active, Resolved, Cancelled }
    struct Curve { int256 mean; uint256 sigma; }
    struct MarketConfig {
        address resolver;
        bytes32 rulesHash;
        string rulesURI;
        string units;
        int256 origin;
        uint256 scale;
        uint256 outcomeStep;
        uint256 backing;
        uint256 k;
        int256 minMean;
        int256 maxMean;
        uint256 minSigma;
        uint256 maxSigma;
        int256 minOutcome;
        int256 maxOutcome;
        uint64 closeAt;
        uint64 resolveBy;
    }
    struct Market {
        address sponsor;
        address resolver;
        bytes32 rulesHash;
        string rulesURI;
        string units;
        int256 origin;
        uint256 scale;
        uint256 outcomeStep;
        uint256 backing;
        uint256 k;
        int256 minMean;
        int256 maxMean;
        uint256 minSigma;
        uint256 maxSigma;
        int256 minOutcome;
        int256 maxOutcome;
        uint64 closeAt;
        uint64 resolveBy;
        Curve initialCurve;
        Curve currentCurve;
        uint256 nonce;
        Status status;
        int256 outcome;
        bytes32 evidenceHash;
        uint256 deposited;
        uint256 paid;
        bool sponsorClaimed;
    }
    struct Receipt {
        address owner;
        uint256 marketId;
        Curve oldCurve;
        Curve newCurve;
        uint256 deposit;
        bool claimed;
    }

    IERC20Metadata public immutable token;
    address public immutable operator;
    uint256 public marketCount;
    uint256 public receiptCount;
    uint256 public totalLiability;
    mapping(uint256 id => Market) private markets;
    mapping(uint256 id => Receipt) private receipts;

    error Unauthorized();
    error InvalidConfiguration();
    error InvalidMarket();
    error InvalidState();
    error InvalidTime();
    error StalePreview();
    error InvalidQuote();
    error InvalidCurve();
    error InvalidOutcome();
    error AlreadyClaimed();
    error NotOwner();
    error NotSponsor();
    error EscrowMismatch();

    event MarketCreated(uint256 indexed marketId, address indexed sponsor, address indexed resolver, bytes32 rulesHash);
    event CurveChanged(uint256 indexed marketId, uint256 indexed receiptId, address indexed owner, uint256 nonce, int256 oldMean, uint256 oldSigma, int256 newMean, uint256 newSigma, uint256 deposit);
    event MarketResolved(uint256 indexed marketId, int256 outcome, bytes32 evidenceHash);
    event MarketCancelled(uint256 indexed marketId);
    event PositionClaimed(uint256 indexed marketId, uint256 indexed receiptId, address indexed owner, uint256 amount);
    event SponsorClaimed(uint256 indexed marketId, address indexed sponsor, uint256 amount);

    constructor(address tokenAddress, address operatorAddress) {
        if (tokenAddress == address(0) || operatorAddress == address(0) || tokenAddress.code.length == 0) revert InvalidConfiguration();
        IERC20Metadata configuredToken = IERC20Metadata(tokenAddress);
        if (configuredToken.decimals() != 6) revert InvalidConfiguration();
        token = configuredToken;
        operator = operatorAddress;
    }

    function createMarket(MarketConfig calldata config, Curve calldata initialCurve)
        external nonReentrant returns (uint256 marketId)
    {
        if (msg.sender != operator) revert Unauthorized();
        if (config.resolver == address(0) || config.rulesHash == bytes32(0) || bytes(config.rulesURI).length == 0 || bytes(config.units).length == 0) revert InvalidConfiguration();
        if (config.scale == 0 || config.scale > 1e38 || config.origin < -int256(1e38) || config.origin > int256(1e38) || config.outcomeStep == 0 || config.outcomeStep > 1e18 || config.backing == 0 || config.minMean > config.maxMean || config.minOutcome >= config.maxOutcome || config.minSigma > config.maxSigma) revert InvalidConfiguration();
        if (block.timestamp >= config.closeAt || config.closeAt >= config.resolveBy) revert InvalidTime();
        if (config.minMean < -1000e18 || config.maxMean > 1000e18 || config.minOutcome < -1000e18 || config.maxOutcome > 1000e18 || config.minSigma < 1e16 || config.maxSigma > 100e18) revert InvalidConfiguration();
        if (config.minOutcome % int256(config.outcomeStep) != 0 || config.maxOutcome % int256(config.outcomeStep) != 0) revert InvalidConfiguration();
        _validateCurve(initialCurve, config);
        marketId = ++marketCount;
        Market storage market = markets[marketId];
        market.sponsor = msg.sender;
        market.resolver = config.resolver;
        market.rulesHash = config.rulesHash;
        market.rulesURI = config.rulesURI;
        market.units = config.units;
        market.origin = config.origin;
        market.scale = config.scale;
        market.outcomeStep = config.outcomeStep;
        market.backing = config.backing;
        market.k = config.k;
        market.minMean = config.minMean;
        market.maxMean = config.maxMean;
        market.minSigma = config.minSigma;
        market.maxSigma = config.maxSigma;
        market.minOutcome = config.minOutcome;
        market.maxOutcome = config.maxOutcome;
        market.closeAt = config.closeAt;
        market.resolveBy = config.resolveBy;
        market.initialCurve = initialCurve;
        market.currentCurve = initialCurve;
        market.deposited = config.backing;
        _pullExact(msg.sender, config.backing);
        totalLiability += config.backing;
        emit MarketCreated(marketId, msg.sender, config.resolver, config.rulesHash);
    }

    function getMarket(uint256 marketId) external view returns (Market memory market) {
        market = markets[marketId];
        if (market.sponsor == address(0)) revert InvalidMarket();
    }

    function getReceipt(uint256 receiptId) external view returns (Receipt memory receipt) {
        receipt = receipts[receiptId];
        if (receipt.owner == address(0)) revert InvalidMarket();
    }

    function normalizeOutcome(uint256 marketId, int256 rawValueWad) public view returns (int256 outcomeWad) {
        Market storage market = _market(marketId);
        if (rawValueWad < -int256(1e38) || rawValueWad > int256(1e38)) revert InvalidOutcome();
        // Normalize once, then round to the canonical step; exact halves are away from zero.
        int256 numerator = (rawValueWad - market.origin) * int256(1e18);
        int256 step = int256(market.outcomeStep);
        int256 denominator = int256(market.scale) * step;
        int256 quotient = numerator / denominator;
        int256 remainder = numerator % denominator;
        uint256 magnitude = uint256(remainder < 0 ? -remainder : remainder);
        if (magnitude * 2 >= uint256(denominator)) quotient += numerator < 0 ? int256(-1) : int256(1);
        outcomeWad = quotient * step;
        if (outcomeWad < market.minOutcome || outcomeWad > market.maxOutcome) revert InvalidOutcome();
        GaussianMath.validateOutcome(outcomeWad);
    }

    function trade(uint256 marketId, Curve calldata newCurve, uint256 expectedNonce, uint256 maxDeposit, uint256 deadline)
        external nonReentrant returns (uint256 receiptId)
    {
        Market storage market = _market(marketId);
        if (market.status != Status.Active || block.timestamp >= market.closeAt) revert InvalidState();
        if (block.timestamp > deadline) revert InvalidTime();
        if (expectedNonce != market.nonce) revert StalePreview();
        if (newCurve.mean == market.currentCurve.mean && newCurve.sigma == market.currentCurve.sigma) revert InvalidCurve();
        _validateCurve(newCurve, _configView(market));
        uint256 deposit = market.backing;
        if (deposit > maxDeposit) revert InvalidQuote();
        Curve memory oldCurve = market.currentCurve;
        receiptId = ++receiptCount;
        receipts[receiptId] = Receipt(msg.sender, marketId, oldCurve, newCurve, deposit, false);
        market.currentCurve = newCurve;
        ++market.nonce;
        market.deposited += deposit;
        _pullExact(msg.sender, deposit);
        totalLiability += deposit;
        emit CurveChanged(marketId, receiptId, msg.sender, market.nonce, oldCurve.mean, oldCurve.sigma, newCurve.mean, newCurve.sigma, deposit);
    }

    function resolve(uint256 marketId, int256 outcomeWad, bytes32 evidenceHash) external {
        Market storage market = _market(marketId);
        if (msg.sender != market.resolver) revert Unauthorized();
        if (market.status != Status.Active) revert InvalidState();
        if (block.timestamp < market.closeAt || block.timestamp >= market.resolveBy) revert InvalidTime();
        if (evidenceHash == bytes32(0)) revert InvalidOutcome();
        if (outcomeWad < market.minOutcome || outcomeWad > market.maxOutcome || outcomeWad % int256(market.outcomeStep) != 0) revert InvalidOutcome();
        GaussianMath.validateOutcome(outcomeWad);
        market.outcome = outcomeWad;
        market.evidenceHash = evidenceHash;
        market.status = Status.Resolved;
        emit MarketResolved(marketId, outcomeWad, evidenceHash);
    }

    function cancelExpired(uint256 marketId) external {
        Market storage market = _market(marketId);
        if (market.status != Status.Active || block.timestamp < market.resolveBy) revert InvalidState();
        market.status = Status.Cancelled;
        emit MarketCancelled(marketId);
    }

    function previewTrade(uint256 marketId, Curve calldata newCurve) external view
        returns (Curve memory oldCurve, Curve memory proposedCurve, uint256 deposit, uint256 nonce)
    {
        Market storage market = _market(marketId);
        if (market.status != Status.Active || block.timestamp >= market.closeAt) revert InvalidState();
        _validateCurve(newCurve, _configView(market));
        return (market.currentCurve, newCurve, market.backing, market.nonce);
    }

    function previewClaim(uint256 receiptId) public view returns (uint256 amount) {
        Receipt storage receipt = receipts[receiptId];
        if (receipt.owner == address(0)) revert InvalidMarket();
        if (receipt.claimed) revert AlreadyClaimed();
        Market storage market = _market(receipt.marketId);
        if (market.status == Status.Cancelled) return receipt.deposit;
        if (market.status != Status.Resolved) revert InvalidState();
        uint256 newValue = _evaluate(receipt.newCurve, market);
        uint256 oldValue = _evaluate(receipt.oldCurve, market);
        amount = receipt.deposit + newValue - oldValue;
    }

    function previewSponsorClaim(uint256 marketId) public view returns (uint256 amount) {
        Market storage market = _market(marketId);
        if (market.sponsorClaimed) revert AlreadyClaimed();
        if (market.status == Status.Cancelled) return market.backing;
        if (market.status != Status.Resolved) revert InvalidState();
        uint256 initialValue = _evaluate(market.initialCurve, market);
        uint256 finalValue = _evaluate(market.currentCurve, market);
        amount = market.backing + initialValue - finalValue;
    }

    function claim(uint256 receiptId) external nonReentrant returns (uint256 amount) {
        Receipt storage receipt = receipts[receiptId];
        if (receipt.owner == address(0)) revert InvalidMarket();
        if (msg.sender != receipt.owner) revert NotOwner();
        amount = previewClaim(receiptId);
        Market storage market = markets[receipt.marketId];
        receipt.claimed = true;
        market.paid += amount;
        totalLiability -= amount;
        token.safeTransfer(msg.sender, amount);
        emit PositionClaimed(receipt.marketId, receiptId, msg.sender, amount);
    }

    function claimSponsor(uint256 marketId) external nonReentrant returns (uint256 amount) {
        Market storage market = _market(marketId);
        if (msg.sender != market.sponsor) revert NotSponsor();
        amount = previewSponsorClaim(marketId);
        market.sponsorClaimed = true;
        market.paid += amount;
        totalLiability -= amount;
        token.safeTransfer(msg.sender, amount);
        emit SponsorClaimed(marketId, msg.sender, amount);
    }

    function _validateCurve(Curve memory curve, MarketConfig memory config) private pure {
        if (curve.mean < config.minMean || curve.mean > config.maxMean || curve.sigma < config.minSigma || curve.sigma > config.maxSigma) revert InvalidCurve();
        GaussianMath.validateCurve(GaussianMath.Curve({mean: curve.mean, sigma: curve.sigma}), config.k, config.backing);
    }

    function _evaluate(Curve storage curve, Market storage market) private view returns (uint256) {
        return GaussianMath.evaluate(GaussianMath.Curve({mean: curve.mean, sigma: curve.sigma}), market.k, market.backing, market.outcome);
    }

    function _configView(Market storage market) private view returns (MarketConfig memory config) {
        config.minMean = market.minMean; config.maxMean = market.maxMean;
        config.minSigma = market.minSigma; config.maxSigma = market.maxSigma;
        config.k = market.k; config.backing = market.backing;
    }

    function _market(uint256 id) private view returns (Market storage market) {
        market = markets[id];
        if (market.sponsor == address(0)) revert InvalidMarket();
    }

    function _pullExact(address from, uint256 amount) private {
        uint256 beforeBalance = token.balanceOf(address(this));
        token.safeTransferFrom(from, address(this), amount);
        if (token.balanceOf(address(this)) - beforeBalance != amount) revert EscrowMismatch();
    }
}
