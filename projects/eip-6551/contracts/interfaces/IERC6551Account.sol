// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.0;

/**
 * @title IERC6551Account - ERC-6551 TBA(Account) 표준 인터페이스
 * @notice
 *  - EIP-6551에서 정의하는 토큰 바운드 계정(TBA)의 최소 인터페이스
 *  - 특정 NFT(체인ID/컨트랙트/토큰ID)에 소유권이 귀속되는 계정 개념을 제공합니다.
 * @dev
 *  - 본 프로젝트는 EIP-6551 TBA 개념 학습용 예제입니다.
 */
interface IERC6551Account {
    /**
     * @notice ETH 수신 전용 함수 (plain ETH 전송 허용)
     */
    receive() external payable;

    /**
     * @notice 이 계정이 귀속된 NFT 정보를 반환합니다.
     * @return chainId 귀속 대상이 속한 체인 ID
     * @return tokenContract 귀속 대상 ERC721 컨트랙트 주소
     * @return tokenId 귀속 대상 토큰 ID
     */
    function token()
        external
        view
        returns (uint256 chainId, address tokenContract, uint256 tokenId);

    /**
     * @notice 계정의 상태 카운터(임의 상태)를 조회합니다.
     * @return 현재 상태값(사용처에 따라 커스텀 가능)
     */
    function state() external view returns (uint256);

    /**
     * @notice 서명자 유효성(해당 계정에서의 권한 보유 여부)을 검증합니다.
     * @param signer 검증할 서명자 주소
     * @param context 구현 특화 컨텍스트(미사용 시 빈 바이트)
     * @return magicValue 유효할 경우 IERC6551Account.isValidSigner.selector, 아니면 0x00000000
     */
    function isValidSigner(address signer, bytes calldata context)
        external
        view
        returns (bytes4 magicValue);
}
