// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IERC6150.sol";

/**
 * @title IERC6150AccessControl - 계층형 NFT 접근 제어(뷰) 인터페이스
 * @notice
 *  - 특정 계정이 토큰에 대해 관리자 권한을 가지는지, 자식 발행/소각 가능 여부 등을 조회합니다.
 * @dev
 *  - 읽기 전용 뷰만 정의하며, 설정/변경은 구현 컨트랙트의 권한 모델에 따릅니다.
 */
// Note: the ERC-165 identifier for this interface is 0x1d04f0b3.
interface IERC6150AccessControl is IERC6150 {
    /**
     * @notice `account`가 `tokenId`의 관리자(admin)인지 확인합니다.
     * @param tokenId 토큰 ID
     * @param account 계정 주소
     * @return isAdmin 관리자 권한이면 true
     */
    function isAdminOf(
        uint256 tokenId, 
        address account
    ) external view returns (bool isAdmin);

    /**
     * @notice `account`가 `parentId` 하위에 자식 발행이 가능한지 확인합니다.
     * @dev `parentId`가 0이면 루트 발행 가능 여부를 의미합니다.
     * @param parentId 부모 토큰 ID(0 허용)
     * @param account 계정 주소
     * @return canMint 발행 가능하면 true
     */
    function canMintChildren(
        uint256 parentId, 
        address account
    ) external view returns (bool canMint);

    /**
     * @notice `account`가 `tokenId`를 소각할 수 있는지 확인합니다.
     * @param tokenId 토큰 ID
     * @param account 계정 주소
     * @return canBurn 소각 가능하면 true
     */
    function canBurnTokenByAccount(
        uint256 tokenId, 
        address account
    ) external view returns (bool canBurn);
}
