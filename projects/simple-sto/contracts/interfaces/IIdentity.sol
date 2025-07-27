// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @title IIdentity
 * @dev 간단한 Identity 인터페이스
 */
interface IIdentity {
    function isClaimValid(address _identity, uint256 _claimTopic, bytes calldata _sig) external view returns (bool);
    function getClaim(address _identity, uint256 _claimTopic) external view returns (bytes32, uint256, address, bytes memory, bytes memory, uint256);
} 