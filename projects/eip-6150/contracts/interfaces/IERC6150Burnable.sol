// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IERC6150.sol";

/**
 * @title IERC6150Burnable - 계층형 NFT 소각 인터페이스
 * @notice
 *  - 리프 토큰에 대한 안전 소각(safe burn) 단건/배치 기능을 정의합니다.
 * @dev
 *  - 구현체는 리프 여부 검사를 필수로 수행해야 하며, 권한 체크를 통해 안전하게 소각되어야 합니다.
 */
// Note: the ERC-165 identifier for this interface is 0x4ac0aa46.
// interface IERC6150Burnable is IERC6150
interface IERC6150Burnable is IERC6150 {
    /**
     * @notice `tokenId`를 소각합니다(리프 토큰만 허용).
     * @param tokenId 소각할 토큰 ID
     */
    function safeBurn(uint256 tokenId) external;

    /**
     * @notice 여러 토큰을 일괄 소각합니다(모두 리프 토큰이어야 함).
     * @param tokenIds 소각할 토큰 ID 배열
     */
    function safeBatchBurn(uint256[] memory tokenIds) external;
}
