// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IERC6150.sol";

// Note: the ERC-165 identifier for this interface is 0x4ac0aa46.
// interface IERC6150Burnable is IERC6150
interface IERC6150Burnable is IERC6150 {
    /**
     * @notice Burn the `tokenId` token (must be a leaf).
     */
    function safeBurn(uint256 tokenId) external;

    /**
     * @notice Batch burn tokens (all must be leaf).
     */
    function safeBatchBurn(uint256[] memory tokenIds) external;
}
