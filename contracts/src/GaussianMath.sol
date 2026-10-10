// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ud} from "@prb/math/src/UD60x18.sol";
import {sd} from "@prb/math/src/SD59x18.sol";

/// @notice Deterministic Gaussian outcome function, in integer micro-USDC.
/// @dev All limits and the error argument are specified in reference/numeric-spec.md.
/// Uses the immutable market norm k, not a probability density or stake size.
library GaussianMath {
    struct Curve {
        int256 mean;
        uint256 sigma;
    }

    uint256 internal constant WAD = 1e18;
    uint256 internal constant MICRO_TO_WAD = 1e12;
    int256 internal constant COORDINATE_LIMIT = 1000e18;
    uint256 internal constant MIN_SIGMA = 1e16;
    uint256 internal constant MAX_SIGMA = 100e18;
    uint256 internal constant MIN_BACKING = 1e6;
    uint256 internal constant MAX_BACKING = 1e9;
    uint256 internal constant MAX_NORM = 1e22;
    uint256 internal constant SQRT_PI_WAD = 1_772453850905516027;
    uint256 internal constant TAIL_SIGMAS = 8;

    error InvalidCoordinate();
    error InvalidSigma();
    error InvalidBacking();
    error InvalidNorm();
    error InsufficientBacking();

    function validateOutcome(int256 outcome) internal pure {
        if (outcome < -COORDINATE_LIMIT || outcome > COORDINATE_LIMIT) revert InvalidCoordinate();
    }

    function validateCurve(Curve memory curve, uint256 normWad, uint256 backingMicro) internal pure {
        validateOutcome(curve.mean);
        if (curve.sigma < MIN_SIGMA || curve.sigma > MAX_SIGMA) revert InvalidSigma();
        if (backingMicro < MIN_BACKING || backingMicro > MAX_BACKING) revert InvalidBacking();
        if (normWad == 0 || normWad > MAX_NORM) revert InvalidNorm();
        // One micro-USDC of peak headroom exceeds the proven numerical error.
        if (_peakWad(curve.sigma, normWad) > (backingMicro - 1) * MICRO_TO_WAD) {
            revert InsufficientBacking();
        }
    }

    /// @return valueMicro Rounded nearest micro-USDC, ties upward; always in [0,b].
    function evaluate(Curve memory curve, uint256 normWad, uint256 backingMicro, int256 outcome)
        internal
        pure
        returns (uint256 valueMicro)
    {
        validateCurve(curve, normWad, backingMicro);
        validateOutcome(outcome);
        int256 difference = outcome - curve.mean;
        uint256 distance = uint256(difference < 0 ? -difference : difference);
        // Check before squaring. The discarded analytic tail is <0.000012665 micro-USDC.
        if (distance >= TAIL_SIGMAS * curve.sigma) return 0;
        uint256 ratioWad = distance * WAD / curve.sigma;
        uint256 exponentWad = ratioWad * ratioWad / (2 * WAD);
        uint256 decayWad = uint256(sd(-int256(exponentWad)).exp().unwrap());
        uint256 valueWad = _peakWad(curve.sigma, normWad) * decayWad / WAD;
        valueMicro = (valueWad + MICRO_TO_WAD / 2) / MICRO_TO_WAD;
        // Accounting safeguard; admitted curves have one micro of peak headroom.
        if (valueMicro > backingMicro) valueMicro = backingMicro;
    }

    function _peakWad(uint256 sigmaWad, uint256 normWad) private pure returns (uint256) {
        uint256 denominatorWad = ud(sigmaWad * SQRT_PI_WAD / WAD).sqrt().unwrap();
        return normWad * WAD / denominatorWad;
    }
}
