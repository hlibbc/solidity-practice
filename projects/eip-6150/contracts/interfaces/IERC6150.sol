// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Note: the ERC-165 identifier for this interface is 0x897e2c73.
// interface IERC6150 /* is IERC721, IERC165 */
interface IERC6150 {
    /**
     * @notice Emitted when `tokenId` token under `parentId` is minted.
     * @param minter The address of minter
     * @param to The address receiving token
     * @param parentId The id of parent token, if zero then `tokenId` is a root token.
     * @param tokenId The id of minted token, required to be greater than zero
     */
    event Minted(
        address indexed minter,
        address indexed to,
        uint256 parentId,
        uint256 tokenId
    );

    /**
     * @notice Get the parent token of `tokenId`.
     */
    function parentOf(uint256 tokenId) external view returns (uint256 parentId);

    /**
     * @notice Get the children tokens of `tokenId` (parent).
     */
    function childrenOf(uint256 tokenId) external view returns (uint256[] memory childrenIds);

    /**
     * @notice Check if `tokenId` is a root token.
     */
    function isRoot(uint256 tokenId) external view returns (bool);

    /**
     * @notice Check if `tokenId` is a leaf token.
     */
    function isLeaf(uint256 tokenId) external view returns (bool);
}
