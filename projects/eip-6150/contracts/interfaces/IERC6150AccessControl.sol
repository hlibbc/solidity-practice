// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IERC6150.sol";

// Note: the ERC-165 identifier for this interface is 0x1d04f0b3.
// interface IERC6150AccessControl is IERC6150
interface IERC6150AccessControl is IERC6150 {
    /**
     * @notice Check if `account` is an admin of `tokenId`.
     */
    function isAdminOf(uint256 tokenId, address account) external view returns (bool);

    /**
     * @notice Check whether `account` can mint children under `parentId`.
     * @dev If `parentId` is zero, check whether account can mint root nodes.
     */
    function canMintChildren(uint256 parentId, address account) external view returns (bool);

    /**
     * @notice Check whether `account` can burn `tokenId`.
     */
    function canBurnTokenByAccount(uint256 tokenId, address account) external view returns (bool);
}
