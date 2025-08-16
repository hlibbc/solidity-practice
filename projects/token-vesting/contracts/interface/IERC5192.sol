// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title EIP-5192 (Minimal SBT) 인터페이스
 * @notice Soulbound Token의 잠금 상태를 관리하는 최소 인터페이스
 * @dev 
 * - EIP-5192 표준을 구현한 Soulbound Token의 잠금 기능
 * - 토큰의 잠금/해제 상태를 추적하고 이벤트로 알림
 * - Spec: https://eips.ethereum.org/EIPS/eip-5192 (CC0)
 */
interface IERC5192 {
    /**
     * @notice 토큰이 잠금 상태로 변경될 때 발생하는 이벤트
     * @param tokenId 잠금된 토큰의 ID
     */
    event Locked(uint256 tokenId);
    
    /**
     * @notice 토큰이 해제 상태로 변경될 때 발생하는 이벤트
     * @param tokenId 해제된 토큰의 ID
     */
    event Unlocked(uint256 tokenId);
    
    /**
     * @notice Soulbound Token의 잠금 상태 조회
     * @param tokenId 조회할 토큰의 ID
     * @return true면 잠금 상태, false면 해제 상태
     */
    function locked(uint256 tokenId) external view returns (bool);
}