// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.4;

/**
 * @title IERC6551Registry - ERC-6551 레지스트리 인터페이스
 * @notice
 *  - TBA(Account) 배포/조회의 표준 진입점
 */
interface IERC6551Registry {
    event ERC6551AccountCreated(
        address account,
        address indexed implementation,
        bytes32 salt,
        uint256 chainId,
        address indexed tokenContract,
        uint256 indexed tokenId
    );

    error AccountCreationFailed();

    /**
     * @notice 주어진 매개변수로 TBA(Account)를 배포하고 주소를 반환합니다.
     * @param implementation 구현 컨트랙트(로직) 주소
     * @param salt CREATE2에 사용될 솔트
     * @param chainId 귀속 대상 체인 ID
     * @param tokenContract 귀속 대상 ERC721 컨트랙트 주소
     * @param tokenId 귀속 대상 토큰 ID
     * @return account 배포(또는 기존 계산 결과)의 계정 주소
     */
    function createAccount(
        address implementation,
        bytes32 salt,
        uint256 chainId,
        address tokenContract,
        uint256 tokenId
    ) external returns (address account);

    /**
     * @notice 배포 없이 동일 파라미터로 계산되는 TBA 주소를 조회합니다.
     * @param implementation 구현 컨트랙트(로직) 주소
     * @param salt CREATE2에 사용될 솔트
     * @param chainId 귀속 대상 체인 ID
     * @param tokenContract 귀속 대상 ERC721 컨트랙트 주소
     * @param tokenId 귀속 대상 토큰 ID
     * @return account 계산된 계정 주소
     */
    function account(
        address implementation,
        bytes32 salt,
        uint256 chainId,
        address tokenContract,
        uint256 tokenId
    ) external view returns (address account);
}
