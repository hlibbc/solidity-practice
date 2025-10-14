// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IVRFProxy {
    function requestRandom(bytes32 ctx, address refundRecipient) external payable returns (uint256);
}