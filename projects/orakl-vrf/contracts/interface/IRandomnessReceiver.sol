// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IRandomnessReceiver {
    function onRandomnessReady(uint256 requestId, uint256 randomWord, bytes32 ctx) external;
}