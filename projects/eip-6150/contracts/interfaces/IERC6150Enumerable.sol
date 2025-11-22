// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IERC6150.sol";

/**
 * @title IERC6150Enumerable - 계층형 NFT 열거 뷰 인터페이스
 * @notice
 *  - 특정 부모 하위의 자식 개수/인덱스 접근 등 열거 관련 읽기 전용 함수를 정의합니다.
 * @dev
 *  - 루트 레벨(parentId=0)에 대해서도 동일한 의미(루트 모음)를 갖습니다.
 */
// Note: the ERC-165 identifier for this interface is 0xba541a2e.
interface IERC6150Enumerable is IERC6150 {
    /**
     * @notice `parentId` 하위 자식 토큰 수를 반환합니다.
     * @dev `parentId`가 0이면 루트 토큰의 전체 개수를 의미합니다.
     * @param parentId 부모 토큰 ID(0 허용)
     * @return count 자식(또는 루트) 개수
     */
    function childrenCountOf(uint256 parentId) external view returns (uint256 count);

    /**
     * @notice 부모 `parentId` 하위 자식 중 `index` 위치의 토큰 ID를 반환합니다.
     * @dev `parentId`가 0이면 루트 토큰의 인덱스 접근을 의미합니다.
     * @param parentId 부모 토큰 ID(0 허용)
     * @param index 0-based 인덱스
     * @return tokenId 해당 위치의 토큰 ID
     */
    function childOfParentByIndex(
        uint256 parentId, 
        uint256 index
    ) external view returns (uint256 tokenId);

    /**
     * @notice `parentId` 하위에서 `tokenId`의 인덱스를 반환합니다.
     * @dev `tokenId`가 `parentId`의 자식이 아니면 revert됩니다.
     * @param parentId 부모 토큰 ID(0 허용)
     * @param tokenId 자식 토큰 ID
     * @return index 0-based 인덱스
     */
    function indexInChildrenEnumeration(
        uint256 parentId, 
        uint256 tokenId
    ) external view returns (uint256 index);
}
