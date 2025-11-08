// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IERC6150 - 계층형 NFT Core 인터페이스
 * @notice
 *  - ERC-721을 기반으로 트리 형태의 계층 구조를 갖는 토큰 표준의 코어 뷰를 정의합니다.
 *  - 부모-자식 관계, 루트/리프 판별, 자식 목록 조회 등의 최소 기능을 포함합니다.
 * @dev
 *  - 구현 컨트랙트는 ERC-165를 통해 본 인터페이스 지원을 선언해야 합니다.
 */
// Note: the ERC-165 identifier for this interface is 0x897e2c73.
// interface IERC6150 /* is IERC721, IERC165 */
interface IERC6150 {
    /**
     * @notice 부모 `parentId` 하위에 `tokenId` 토큰이 발행될 때 발생합니다.
     * @param minter 발행자 주소
     * @param to 토큰 수령자 주소
     * @param parentId 부모 토큰 ID, 0이면 루트 토큰을 의미
     * @param tokenId 발행된 토큰 ID(0보다 커야 함)
     */
    event Minted(
        address indexed minter,
        address indexed to,
        uint256 parentId,
        uint256 tokenId
    );

    /**
     * @notice `tokenId`의 부모 토큰을 반환합니다.
     * @param tokenId 부모를 조회할 토큰 ID
     * @return parentId 부모 토큰 ID(루트일 경우 0)
     */
    function parentOf(uint256 tokenId) external view returns (uint256 parentId);

    /**
     * @notice 부모 `tokenId`의 자식 토큰 목록을 반환합니다.
     * @param tokenId 자식 목록을 조회할 부모 토큰 ID
     * @return childrenIds 자식 토큰 ID 배열
     */
    function childrenOf(uint256 tokenId) external view returns (uint256[] memory childrenIds);

    /**
     * @notice `tokenId`가 루트 토큰인지 확인합니다.
     * @param tokenId 확인할 토큰 ID
     * @return isRootToken 루트 토큰이면 true
     */
    function isRoot(uint256 tokenId) external view returns (bool isRootToken);

    /**
     * @notice `tokenId`가 리프 토큰인지 확인합니다.
     * @param tokenId 확인할 토큰 ID
     * @return isLeafToken 리프 토큰이면 true
     */
    function isLeaf(uint256 tokenId) external view returns (bool isLeafToken);
}
