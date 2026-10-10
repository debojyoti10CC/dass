// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {ERC20} from '@openzeppelin/contracts/token/ERC20/ERC20.sol';

/// @dev Test token only. Never configured as Arc USDC in the public manifest.
contract MockUSDC is ERC20 {
    bool public failTransfers;
    address public callbackTarget;
    bytes public callbackData;
    bool public callbackSucceeded;
    bytes public callbackResult;
    constructor() ERC20('Local mock USDC', 'USDC') {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function setFailTransfers(bool fail) external { failTransfers = fail; }
    function setCallback(address target, bytes calldata data) external { callbackTarget = target; callbackData = data; }
    function _update(address from, address to, uint256 amount) internal override {
        require(!failTransfers, 'Restricted transfer');
        super._update(from, to, amount);
        if (callbackTarget != address(0) && from != address(0)) {
            (callbackSucceeded, callbackResult) = callbackTarget.call(callbackData);
        }
    }
}
