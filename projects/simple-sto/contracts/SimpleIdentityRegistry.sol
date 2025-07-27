// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IIdentity.sol";

/**
 * @title SimpleIdentityRegistry
 * @dev T-REX Identity Registry와 연동하는 간단한 래퍼
 */
contract SimpleIdentityRegistry is Ownable {
    
    // ============ 상태 변수 ============
    
    /// @dev T-REX Identity Registry 주소
    address public trexIdentityRegistry;
    
    /// @dev T-REX Trusted Issuers Registry 주소
    address public trexTrustedIssuersRegistry;
    
    /// @dev T-REX Claim Topics Registry 주소
    address public trexClaimTopicsRegistry;
    
    /// @dev 로컬 투자자 정보 (백업용)
    mapping(address => bool) public localInvestors;
    
    /// @dev 투자자 국가 정보
    mapping(address => uint16) public investorCountries;
    
    // ============ 이벤트 ============
    
    event TREXRegistrySet(address indexed registry);
    event LocalInvestorRegistered(address indexed investor, uint16 country);
    event LocalInvestorRemoved(address indexed investor);
    
    // ============ 생성자 ============
    
    constructor() Ownable(msg.sender) {
        // 초기 설정
    }
    
    // ============ 관리자 함수 ============
    
    /**
     * @dev T-REX Identity Registry 설정
     */
    function setTREXIdentityRegistry(address _registry) external onlyOwner {
        trexIdentityRegistry = _registry;
        emit TREXRegistrySet(_registry);
    }
    
    /**
     * @dev T-REX Trusted Issuers Registry 설정
     */
    function setTREXTrustedIssuersRegistry(address _registry) external onlyOwner {
        trexTrustedIssuersRegistry = _registry;
    }
    
    /**
     * @dev T-REX Claim Topics Registry 설정
     */
    function setTREXClaimTopicsRegistry(address _registry) external onlyOwner {
        trexClaimTopicsRegistry = _registry;
    }
    
    /**
     * @dev 로컬 투자자 등록 (백업용)
     */
    function registerLocalInvestor(address _investor, uint16 _country) external onlyOwner {
        localInvestors[_investor] = true;
        investorCountries[_investor] = _country;
        emit LocalInvestorRegistered(_investor, _country);
    }
    
    /**
     * @dev 로컬 투자자 제거
     */
    function removeLocalInvestor(address _investor) external onlyOwner {
        localInvestors[_investor] = false;
        investorCountries[_investor] = 0;
        emit LocalInvestorRemoved(_investor);
    }
    
    // ============ 검증 함수 ============
    
    /**
     * @dev 투자자 검증 (T-REX + 로컬)
     */
    function isInvestorVerified(address _investor) external view returns (bool) {
        // 1. T-REX Identity Registry 검증
        if (trexIdentityRegistry != address(0)) {
            try this.callTREXVerification(_investor) returns (bool trexVerified) {
                if (trexVerified) {
                    return true;
                }
            } catch {
                // T-REX 검증 실패 시 로컬 검증으로 폴백
            }
        }
        
        // 2. 로컬 투자자 검증
        return localInvestors[_investor];
    }
    
    /**
     * @dev T-REX 검증 호출 (외부 호출용)
     */
    function callTREXVerification(address /* _investor */) external view returns (bool) {
        if (trexIdentityRegistry == address(0)) {
            return false;
        }
        
        // T-REX Identity Registry의 isVerified 함수 호출
        // 실제 구현에서는 인터페이스를 통해 호출
        // bytes memory data = abi.encodeWithSignature("isVerified(address)", _investor);
        // (bool success, bytes memory result) = trexIdentityRegistry.staticcall(data);
        // if (success) {
        //     return abi.decode(result, (bool));
        // }
        
        return false; // 임시 반환값
    }
    
    /**
     * @dev 투자자 국가 조회
     */
    function getInvestorCountry(address _investor) external view returns (uint16) {
        return investorCountries[_investor];
    }
    
    /**
     * @dev T-REX 연동 상태 확인
     */
    function getTREXStatus() external view returns (
        bool identityRegistrySet,
        bool trustedIssuersSet,
        bool claimTopicsSet
    ) {
        return (
            trexIdentityRegistry != address(0),
            trexTrustedIssuersRegistry != address(0),
            trexClaimTopicsRegistry != address(0)
        );
    }
} 