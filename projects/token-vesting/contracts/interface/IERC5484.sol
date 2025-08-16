// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title EIP-5484 (Consensual SBT) 인터페이스
 * @notice 합의 기반 Soulbound Token의 소각 권한을 관리하는 인터페이스
 * @dev 
 * - EIP-5484 표준을 구현한 Consensual SBT의 소각 권한 관리
 * - 토큰 발행 시 소각 권한을 명시적으로 설정
 * - Spec: https://eips.ethereum.org/EIPS/eip-5484 (CC0)
 */
interface IERC5484 {
    /**
     * @notice 표준화된 소각 권한 코드
     * @dev 
     * - IssuerOnly: 발행자만 소각 가능
     * - OwnerOnly: 소유자만 소각 가능
     * - Both: 발행자와 소유자 모두 소각 가능
     * - Neither: 아무도 소각 불가
     */
    enum BurnAuth {
        IssuerOnly,
        OwnerOnly,
        Both,
        Neither
    }

    /**
     * @notice SBT 발행 시 발생하는 이벤트 (Transfer와 함께 발생)
     * @param from 토큰 발행자 주소
     * @param to 토큰 수신자 주소
     * @param tokenId 발행된 토큰의 ID
     * @param burnAuth 해당 토큰의 소각 권한 설정
     */
    event Issued(
        address indexed from,
        address indexed to,
        uint256 indexed tokenId,
        BurnAuth burnAuth
    );

    /**
     * @notice 특정 토큰의 소각 권한 조회
     * @param tokenId 조회할 토큰의 ID
     * @return 해당 토큰의 소각 권한 설정 (BurnAuth 열거형)
     */
    function burnAuth(uint256 tokenId) external view returns (BurnAuth);
}