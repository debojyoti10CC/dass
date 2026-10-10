// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {DistributionMarkets} from "../src/DistributionMarkets.sol";

interface DeploymentVm {
    function envAddress(string calldata name) external returns (address);
    function startBroadcast() external;
    function stopBroadcast() external;
}

/// @dev Invoke with an encrypted Foundry account or external signer. No key is read here.
contract Deploy {
    DeploymentVm private constant vm = DeploymentVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant ARC_USDC = 0x3600000000000000000000000000000000000000;

    function run() external returns (DistributionMarkets deployed) {
        require(block.chainid == 5042002, "Arc Testnet only");
        address operator = vm.envAddress("ARC_OPERATOR_ADDRESS");
        require(operator != address(0), "Operator is required");
        vm.startBroadcast();
        deployed = new DistributionMarkets(ARC_USDC, operator);
        vm.stopBroadcast();
    }
}
