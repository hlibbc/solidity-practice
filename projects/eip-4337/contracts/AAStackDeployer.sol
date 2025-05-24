// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@account-abstraction/contracts/core/EntryPoint.sol";
import "./SimpleWalletFactory.sol";
import "./SimplePaymaster.sol";

contract AAStackDeployer {
    EntryPoint public entryPoint;
    SimpleWalletFactory public walletFactory;
    SimplePaymaster public paymaster;

    constructor(address verifyingSigner) {
        entryPoint = new EntryPoint();
        walletFactory = new SimpleWalletFactory(entryPoint);
        paymaster = new SimplePaymaster(entryPoint, verifyingSigner);
    }

    function getAddresses() public view returns (address, address, address) {
        return (address(entryPoint), address(walletFactory), address(paymaster));
    }
}
