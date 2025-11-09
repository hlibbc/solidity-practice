// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.4;

interface IERC7053 {
    /// Emitted when a new commit is made.
    event Commit(address indexed recorder, string indexed assetCid, string commitData);

    /// Registers a commit for an asset and returns the block number.
    function commit(string memory assetCid, string memory commitData) external returns (uint256 blockNumber);
}