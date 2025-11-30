// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IERC6150.sol";

/**
 * @title IERC6150ParentTransferable - 계층형 NFT 부모 변경 인터페이스
 * @notice
 *  - 토큰의 부모를 다른 노드로 옮기는 기능(루트 승격 포함)을 정의합니다.
 * @dev
 *  - 유효성(순환 참조 방지, 자기 자신 금지 등)과 권한 검증은 구현체 책임입니다.
 */
// Note: the ERC-165 identifier for this interface is 0xfa574808.
interface IERC6150ParentTransferable is IERC6150 {
    /**
     * @notice `tokenId`의 부모가 변경되면 발생합니다.
     * @param tokenId 대상 토큰 ID
     * @param oldParentId 이전 부모 토큰 ID(0 가능)
     * @param newParentId 새로운 부모 토큰 ID(0 가능, 0이면 루트 승격)
     */
    event ParentTransferred(
        uint256 tokenId, 
        uint256 oldParentId, 
        uint256 newParentId
    );

    /**
     * @notice `tokenId`의 부모를 `newParentId`로 변경합니다(0 허용=루트 승격).
     * @param newParentId 새로운 부모 토큰 ID(0 허용)
     * @param tokenId 대상 토큰 ID
     */
    function transferParent(
        uint256 newParentId, 
        uint256 tokenId
    ) external;

    /**
     * @notice 여러 `tokenIds`의 부모를 일괄 변경합니다.
     * @param newParentId 새로운 부모 토큰 ID(0 허용)
     * @param tokenIds 대상 토큰 ID 배열
     */
    function batchTransferParent(
        uint256 newParentId, 
        uint256[] memory tokenIds
    ) external;
}
