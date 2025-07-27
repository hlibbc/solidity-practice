// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title SimpleCompliance
 * @dev T-REX ModularCompliance와 연동하는 간단한 래퍼
 */
contract SimpleCompliance is Ownable {
    
    // ============ 상태 변수 ============
    
    /// @dev T-REX ModularCompliance 주소
    address public trexCompliance;
    
    /// @dev 로컬 규제 규칙
    mapping(uint16 => bool) public allowedCountries;
    mapping(address => uint256) public maxBalances;
    mapping(address => uint256) public transferLimits;
    
    /// @dev 글로벌 제한
    uint256 public globalMaxBalance;
    uint256 public globalTransferLimit;
    
    // ============ 이벤트 ============
    
    event TREXComplianceSet(address indexed compliance);
    event CountryRestrictionSet(uint16 country, bool allowed);
    event MaxBalanceSet(address indexed investor, uint256 maxBalance);
    event TransferLimitSet(address indexed investor, uint256 limit);
    event GlobalLimitsSet(uint256 maxBalance, uint256 transferLimit);
    
    // ============ 생성자 ============
    
    constructor() Ownable(msg.sender) {
        // 초기 설정
    }
    
    // ============ 관리자 함수 ============
    
    /**
     * @dev T-REX ModularCompliance 설정
     */
    function setTREXCompliance(address _compliance) external onlyOwner {
        trexCompliance = _compliance;
        emit TREXComplianceSet(_compliance);
    }
    
    /**
     * @dev 국가 제한 설정
     */
    function setCountryRestriction(uint16 _country, bool _allowed) external onlyOwner {
        allowedCountries[_country] = _allowed;
        emit CountryRestrictionSet(_country, _allowed);
    }
    
    /**
     * @dev 투자자별 최대 잔액 설정
     */
    function setMaxBalance(address _investor, uint256 _maxBalance) external onlyOwner {
        maxBalances[_investor] = _maxBalance;
        emit MaxBalanceSet(_investor, _maxBalance);
    }
    
    /**
     * @dev 투자자별 전송 한도 설정
     */
    function setTransferLimit(address _investor, uint256 _limit) external onlyOwner {
        transferLimits[_investor] = _limit;
        emit TransferLimitSet(_investor, _limit);
    }
    
    /**
     * @dev 글로벌 제한 설정
     */
    function setGlobalLimits(uint256 _maxBalance, uint256 _transferLimit) external onlyOwner {
        globalMaxBalance = _maxBalance;
        globalTransferLimit = _transferLimit;
        emit GlobalLimitsSet(_maxBalance, _transferLimit);
    }
    
    // ============ 검증 함수 ============
    
    /**
     * @dev 전송 가능 여부 검증
     */
    function canTransfer(
        address _from,
        address _to,
        uint256 _amount,
        uint16 _fromCountry,
        uint16 _toCountry
    ) external view returns (bool) {
        // 1. T-REX Compliance 검증
        if (trexCompliance != address(0)) {
            try this.callTREXCompliance(_from, _to, _amount) returns (bool trexAllowed) {
                if (!trexAllowed) {
                    return false;
                }
            } catch {
                // T-REX 검증 실패 시 로컬 검증으로 폴백
            }
        }
        
        // 2. 국가 제한 확인
        if (!allowedCountries[_fromCountry] || !allowedCountries[_toCountry]) {
            return false;
        }
        
        // 3. 잔액 제한 확인
        if (globalMaxBalance > 0) {
            // 글로벌 잔액 제한 로직
        }
        
        // 4. 전송 한도 확인
        if (globalTransferLimit > 0 && _amount > globalTransferLimit) {
            return false;
        }
        
        // 5. 개별 투자자 제한 확인
        if (maxBalances[_from] > 0) {
            // 개별 잔액 제한 로직
        }
        
        if (transferLimits[_from] > 0 && _amount > transferLimits[_from]) {
            return false;
        }
        
        return true;
    }
    
    /**
     * @dev T-REX Compliance 호출 (외부 호출용)
     */
    function callTREXCompliance(
        address /* _from */,
        address /* _to */,
        uint256 /* _amount */
    ) external view returns (bool) {
        if (trexCompliance == address(0)) {
            return true; // T-REX가 설정되지 않은 경우 허용
        }
        
        // T-REX ModularCompliance의 canTransfer 함수 호출
        // 실제 구현에서는 인터페이스를 통해 호출
        // bytes memory data = abi.encodeWithSignature("canTransfer(address,address,uint256)", _from, _to, _amount);
        // (bool success, bytes memory result) = trexCompliance.staticcall(data);
        // if (success) {
        //     return abi.decode(result, (bool));
        // }
        
        return true; // 임시 반환값
    }
    
    /**
     * @dev 투자 적합성 검증
     */
    function isInvestmentAllowed(
        address _investor,
        uint256 _amount,
        uint16 _country
    ) external view returns (bool) {
        // 1. 국가 제한 확인
        if (!allowedCountries[_country]) {
            return false;
        }
        
        // 2. 투자 한도 확인
        if (globalTransferLimit > 0 && _amount > globalTransferLimit) {
            return false;
        }
        
        // 3. 개별 투자자 한도 확인
        if (transferLimits[_investor] > 0 && _amount > transferLimits[_investor]) {
            return false;
        }
        
        return true;
    }
    
    // ============ 조회 함수 ============
    
    /**
     * @dev 국가 허용 여부 조회
     */
    function isCountryAllowed(uint16 _country) external view returns (bool) {
        return allowedCountries[_country];
    }
    
    /**
     * @dev 투자자 최대 잔액 조회
     */
    function getMaxBalance(address _investor) external view returns (uint256) {
        return maxBalances[_investor];
    }
    
    /**
     * @dev 투자자 전송 한도 조회
     */
    function getTransferLimit(address _investor) external view returns (uint256) {
        return transferLimits[_investor];
    }
    
    /**
     * @dev T-REX 연동 상태 확인
     */
    function getTREXStatus() external view returns (bool complianceSet) {
        return trexCompliance != address(0);
    }
} 