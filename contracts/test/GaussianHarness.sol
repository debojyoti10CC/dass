// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {GaussianMath} from '../src/GaussianMath.sol';
contract GaussianHarness {
    function evaluate(GaussianMath.Curve memory curve, uint256 k, uint256 b, int256 x) external pure returns (uint256) {
        return GaussianMath.evaluate(curve, k, b, x);
    }
    function validateCurve(GaussianMath.Curve memory curve, uint256 k, uint256 b) external pure {
        GaussianMath.validateCurve(curve, k, b);
    }
    function validateOutcome(int256 x) external pure { GaussianMath.validateOutcome(x); }
}
