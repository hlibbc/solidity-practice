// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IERC6150.sol";

// Note: the ERC-165 identifier for this interface is 0xfa574808.
// interface IERC6150ParentTransferable is IERC6150
interface IERC6150ParentTransferable is IERC6150 {
    /**
     * @notice Emitted when the parent of `tokenId` changed.
     */
    event ParentTransferred(uint256 tokenId, uint256 oldParentId, uint256 newParentId);

    /**
     * @notice Transfer parentship of `tokenId` to `newParentId` (0 allowed = promote to root).
     */
    function transferParent(uint256 newParentId, uint256 tokenId) external;

    /**
     * @notice Batch transfer parentship of `tokenIds` to `newParentId`.
     */
    function batchTransferParent(uint256 newParentId, uint256[] memory tokenIds) external;
}
