// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "./interfaces/IIdentity.sol";

/**
 * @title SimpleSTO
 * @dev T-REX 기반의 간단한 Security Token Offering 컨트랙트
 * 
 * 주요 기능:
 * - 토큰 발행 및 관리
 * - 투자자 신원 검증
 * - 규제 준수 검증
 * - 투자 한도 관리
 * - 국가별 제한
 */
contract SimpleSTO is ERC20, Ownable, Pausable {
    
    // ============ 상태 변수 ============
    
    /// @dev 투자자 정보 구조체
    struct Investor {
        bool isRegistered;
        uint16 country;
        uint256 maxInvestment;
        uint256 currentInvestment;
        bool isAccredited;
        uint256 registrationDate;
    }
    
    /// @dev STO 설정
    struct STOSettings {
        uint256 totalSupply;
        uint256 pricePerToken;
        uint256 minInvestment;
        uint256 maxInvestment;
        uint256 startDate;
        uint256 endDate;
        bool isActive;
        uint16[] allowedCountries;
        bool requireAccreditation;
    }
    
    // ============ 매핑 및 변수 ============
    
    /// @dev 투자자 주소 -> 투자자 정보
    mapping(address => Investor) public investors;
    
    /// @dev 국가 코드 -> 허용 여부
    mapping(uint16 => bool) public allowedCountries;
    
    /// @dev 신뢰할 수 있는 발급자들
    mapping(address => bool) public trustedIssuers;
    
    /// @dev STO 설정
    STOSettings public stoSettings;
    
    /// @dev Identity Registry (T-REX 기반)
    address public identityRegistry;
    
    /// @dev Compliance 컨트랙트
    address public complianceContract;
    
    /// @dev 총 모집된 금액
    uint256 public totalRaised;
    
    /// @dev 총 발행된 토큰 수
    uint256 public totalIssued;
    
    // ============ 이벤트 ============
    
    event InvestorRegistered(address indexed investor, uint16 country, bool accredited);
    event InvestmentMade(address indexed investor, uint256 amount, uint256 tokens);
    event STOSettingsUpdated(uint256 pricePerToken, uint256 minInvestment, uint256 maxInvestment);
    event CountryRestrictionUpdated(uint16 country, bool allowed);
    event TrustedIssuerUpdated(address indexed issuer, bool trusted);
    
    // ============ 생성자 ============
    
    constructor(
        string memory _name,
        string memory _symbol,
        uint256 _totalSupply,
        uint256 _pricePerToken,
        uint256 _minInvestment,
        uint256 _maxInvestment,
        uint256 _startDate,
        uint256 _endDate
    ) ERC20(_name, _symbol) Ownable(msg.sender) {
        stoSettings = STOSettings({
            totalSupply: _totalSupply,
            pricePerToken: _pricePerToken,
            minInvestment: _minInvestment,
            maxInvestment: _maxInvestment,
            startDate: _startDate,
            endDate: _endDate,
            isActive: true,
            allowedCountries: new uint16[](0),
            requireAccreditation: true
        });
        
        // 초기 토큰을 컨트랙트 소유자에게 발행
        _mint(msg.sender, _totalSupply);
    }
    
    // ============ 수정자 ============
    
    modifier onlyActive() {
        require(stoSettings.isActive, "STO is not active");
        require(block.timestamp >= stoSettings.startDate, "STO has not started");
        require(block.timestamp <= stoSettings.endDate, "STO has ended");
        _;
    }
    
    modifier onlyRegisteredInvestor(address _investor) {
        require(investors[_investor].isRegistered, "Investor not registered");
        _;
    }
    
    modifier onlyTrustedIssuer() {
        require(trustedIssuers[msg.sender], "Only trusted issuers can call this");
        _;
    }
    
    // ============ 관리자 함수 ============
    
    /**
     * @dev Identity Registry 설정
     */
    function setIdentityRegistry(address _identityRegistry) external onlyOwner {
        identityRegistry = _identityRegistry;
    }
    
    /**
     * @dev Compliance 컨트랙트 설정
     */
    function setComplianceContract(address _complianceContract) external onlyOwner {
        complianceContract = _complianceContract;
    }
    
    /**
     * @dev STO 활성화/비활성화
     */
    function setSTOActive(bool _isActive) external onlyOwner {
        stoSettings.isActive = _isActive;
    }
    
    /**
     * @dev STO 설정 업데이트
     */
    function updateSTOSettings(
        uint256 _pricePerToken,
        uint256 _minInvestment,
        uint256 _maxInvestment
    ) external onlyOwner {
        stoSettings.pricePerToken = _pricePerToken;
        stoSettings.minInvestment = _minInvestment;
        stoSettings.maxInvestment = _maxInvestment;
        
        emit STOSettingsUpdated(_pricePerToken, _minInvestment, _maxInvestment);
    }
    
    /**
     * @dev 국가 제한 설정
     */
    function setCountryRestriction(uint16 _country, bool _allowed) external onlyOwner {
        allowedCountries[_country] = _allowed;
        emit CountryRestrictionUpdated(_country, _allowed);
    }
    
    /**
     * @dev 신뢰할 수 있는 발급자 설정
     */
    function setTrustedIssuer(address _issuer, bool _trusted) external onlyOwner {
        trustedIssuers[_issuer] = _trusted;
        emit TrustedIssuerUpdated(_issuer, _trusted);
    }
    
    /**
     * @dev 컨트랙트 일시정지
     */
    function pause() external onlyOwner {
        _pause();
    }
    
    /**
     * @dev 컨트랙트 재개
     */
    function unpause() external onlyOwner {
        _unpause();
    }
    
    // ============ 투자자 등록 함수 ============
    
    /**
     * @dev 투자자 등록 (에이전트만 호출 가능)
     */
    function registerInvestor(
        address _investor,
        uint16 _country,
        bool _accredited,
        uint256 _maxInvestment
    ) external onlyTrustedIssuer {
        require(_investor != address(0), "Invalid investor address");
        require(!investors[_investor].isRegistered, "Investor already registered");
        
        // 국가 제한 확인
        if (stoSettings.allowedCountries.length > 0) {
            bool countryAllowed = false;
            for (uint i = 0; i < stoSettings.allowedCountries.length; i++) {
                if (stoSettings.allowedCountries[i] == _country) {
                    countryAllowed = true;
                    break;
                }
            }
            require(countryAllowed, "Country not allowed");
        }
        
        investors[_investor] = Investor({
            isRegistered: true,
            country: _country,
            maxInvestment: _maxInvestment,
            currentInvestment: 0,
            isAccredited: _accredited,
            registrationDate: block.timestamp
        });
        
        emit InvestorRegistered(_investor, _country, _accredited);
    }
    
    /**
     * @dev 투자자 정보 업데이트
     */
    function updateInvestor(
        address _investor,
        uint16 _country,
        bool _accredited,
        uint256 _maxInvestment
    ) external onlyTrustedIssuer {
        require(investors[_investor].isRegistered, "Investor not registered");
        
        investors[_investor].country = _country;
        investors[_investor].isAccredited = _accredited;
        investors[_investor].maxInvestment = _maxInvestment;
    }
    
    // ============ 투자 함수 ============
    
    /**
     * @dev ETH로 투자
     */
    function invest() external payable onlyActive onlyRegisteredInvestor(msg.sender) whenNotPaused {
        require(msg.value >= stoSettings.minInvestment, "Investment below minimum");
        require(msg.value <= stoSettings.maxInvestment, "Investment above maximum");
        
        Investor storage investor = investors[msg.sender];
        require(investor.currentInvestment + msg.value <= investor.maxInvestment, "Exceeds max investment");
        
        // 규제 준수 검증
        require(validateCompliance(msg.sender, msg.value), "Compliance check failed");
        
        // 토큰 계산
        uint256 tokensToIssue = (msg.value * 10**decimals()) / stoSettings.pricePerToken;
        require(totalIssued + tokensToIssue <= stoSettings.totalSupply, "Exceeds total supply");
        
        // 투자 정보 업데이트
        investor.currentInvestment += msg.value;
        totalRaised += msg.value;
        totalIssued += tokensToIssue;
        
        // 토큰 발행
        _mint(msg.sender, tokensToIssue);
        
        emit InvestmentMade(msg.sender, msg.value, tokensToIssue);
    }
    
    // ============ 검증 함수 ============
    
    /**
     * @dev 규제 준수 검증
     */
    function validateCompliance(address _investor, uint256 _amount) internal view returns (bool) {
        Investor storage investor = investors[_investor];
        
        // 1. 기본 등록 확인
        if (!investor.isRegistered) {
            return false;
        }
        
        // 2. 국가 제한 확인
        if (stoSettings.allowedCountries.length > 0) {
            bool countryAllowed = false;
            for (uint i = 0; i < stoSettings.allowedCountries.length; i++) {
                if (stoSettings.allowedCountries[i] == investor.country) {
                    countryAllowed = true;
                    break;
                }
            }
            if (!countryAllowed) {
                return false;
            }
        }
        
        // 3. 투자 한도 확인
        if (investor.currentInvestment + _amount > investor.maxInvestment) {
            return false;
        }
        
        // 4. 인증 투자자 요구사항 확인
        if (stoSettings.requireAccreditation && !investor.isAccredited) {
            return false;
        }
        
        // 5. Identity Registry 검증 (T-REX 연동)
        if (identityRegistry != address(0)) {
            // T-REX Identity Registry 검증 로직
            // 실제 구현에서는 T-REX의 isVerified 함수 호출
        }
        
        // 6. Compliance 컨트랙트 검증
        if (complianceContract != address(0)) {
            // T-REX ModularCompliance 검증 로직
            // 실제 구현에서는 T-REX의 canTransfer 함수 호출
        }
        
        return true;
    }
    
    // ============ 조회 함수 ============
    
    /**
     * @dev 투자자 정보 조회
     */
    function getInvestor(address _investor) external view returns (
        bool isRegistered,
        uint16 country,
        uint256 maxInvestment,
        uint256 currentInvestment,
        bool isAccredited,
        uint256 registrationDate
    ) {
        Investor storage investor = investors[_investor];
        return (
            investor.isRegistered,
            investor.country,
            investor.maxInvestment,
            investor.currentInvestment,
            investor.isAccredited,
            investor.registrationDate
        );
    }
    
    /**
     * @dev STO 상태 조회
     */
    function getSTOStatus() external view returns (
        bool isActive,
        uint256 totalRaisedAmount,
        uint256 totalIssuedTokens,
        uint256 remainingTokens,
        uint256 timeRemaining
    ) {
        uint256 remaining = stoSettings.totalSupply - totalIssued;
        uint256 timeLeft = stoSettings.endDate > block.timestamp ? 
            stoSettings.endDate - block.timestamp : 0;
            
        return (
            stoSettings.isActive,
            totalRaised,
            totalIssued,
            remaining,
            timeLeft
        );
    }
    
    /**
     * @dev 투자 가능한 토큰 수 계산
     */
    function calculateTokensForInvestment(uint256 _investmentAmount) external view returns (uint256) {
        return (_investmentAmount * 10**decimals()) / stoSettings.pricePerToken;
    }
    
    // ============ 오버라이드 함수 ============
    
    /**
     * @dev ERC20 전송 오버라이드 - 규제 준수 검증 추가
     */
    function _beforeTokenTransfer(
        address /* _from */,
        address to,
        uint256 /* _amount */
    ) internal virtual {
        // 전송 시에도 규제 준수 검증
        if (to != address(0)) { // 발행이 아닌 전송인 경우
            require(validateCompliance(to, 0), "Transfer compliance check failed");
        }
    }
    

} 