// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IERC6150.sol";

// Note: the ERC-165 identifier for this interface is 0xba541a2e.
// interface IERC6150Enumerable is IERC6150 /* IERC721Enumerable */
interface IERC6150Enumerable is IERC6150 {
    /**
     * @notice Get total amount of children tokens under `parentId`.
     * @dev If `parentId` is zero, it means total number of root tokens.
     */
    function childrenCountOf(uint256 parentId) external view returns (uint256);

    /**
     * @notice Get the token at `index` among children under `parentId`.
     * @dev If `parentId` is zero, it means get root token by index.
     */
    function childOfParentByIndex(uint256 parentId, uint256 index) external view returns (uint256);

    /**
     * @notice Get the index of `tokenId` in the children enumeration under `parentId`.
     * @dev Reverts if `tokenId` is not a child of `parentId`.
     */
    function indexInChildrenEnumeration(uint256 parentId, uint256 tokenId) external view returns (uint256);
}
