# 🏗️ SimpleSTO - T-REX 기반 간단한 STO 컨트랙트

## 📋 개요

SimpleSTO는 **T-REX (Token for Regulated EXchanges)** 프로토콜을 기반으로 한 간단한 Security Token Offering (STO) 컨트랙트입니다. 

### 🎯 주요 기능

- ✅ **토큰 발행 및 관리**: ERC-20 기반 보안 토큰
- ✅ **투자자 신원 검증**: T-REX Identity Registry 연동
- ✅ **규제 준수 검증**: T-REX ModularCompliance 연동
- ✅ **투자 한도 관리**: 개별 투자자별 한도 설정
- ✅ **국가별 제한**: 투자 허용 국가 설정
- ✅ **인증 투자자 요구사항**: KYC/AML 준수
- ✅ **일시정지 기능**: 긴급 상황 대응

---

## 🏗️ 아키텍처

### **핵심 컴포넌트**

```
SimpleSTO (메인 컨트랙트)
├── SimpleIdentityRegistry (신원 관리)
├── SimpleCompliance (규제 준수)
└── T-REX 연동 (선택적)
    ├── IdentityRegistry
    ├── ModularCompliance
    ├── TrustedIssuersRegistry
    └── ClaimTopicsRegistry
```

### **데이터 흐름**

```
1. 투자자 등록 → SimpleIdentityRegistry
2. 규제 검증 → SimpleCompliance
3. 투자 실행 → SimpleSTO
4. 토큰 발행 → ERC-20
```

---

## 📦 컨트랙트 설명

### **1. SimpleSTO.sol**

**역할**: 메인 STO 컨트랙트

**주요 기능**:
- 투자자 등록 및 관리
- ETH 투자 처리
- 토큰 발행
- 규제 준수 검증
- 투자 한도 관리

**핵심 함수**:
```solidity
// 투자자 등록
function registerInvestor(address _investor, uint16 _country, bool _accredited, uint256 _maxInvestment)

// ETH 투자
function invest() external payable

// 규제 준수 검증
function validateCompliance(address _investor, uint256 _amount) internal view returns (bool)
```

### **2. SimpleIdentityRegistry.sol**

**역할**: 투자자 신원 관리

**주요 기능**:
- T-REX Identity Registry 연동
- 로컬 투자자 정보 관리
- 투자자 검증

**핵심 함수**:
```solidity
// 투자자 검증
function isInvestorVerified(address _investor) external view returns (bool)

// T-REX 연동 설정
function setTREXIdentityRegistry(address _registry)
```

### **3. SimpleCompliance.sol**

**역할**: 규제 준수 검증

**주요 기능**:
- T-REX ModularCompliance 연동
- 국가별 제한
- 투자 한도 관리
- 전송 제한

**핵심 함수**:
```solidity
// 전송 가능 여부 검증
function canTransfer(address _from, address _to, uint256 _amount, uint16 _fromCountry, uint16 _toCountry)

// 투자 적합성 검증
function isInvestmentAllowed(address _investor, uint256 _amount, uint16 _country)
```

---

## 🚀 사용법

### **1. 배포**

```solidity
// SimpleSTO 배포
const SimpleSTO = await ethers.getContractFactory("SimpleSTO");
const sto = await SimpleSTO.deploy(
    "My Security Token",    // 토큰명
    "MST",                  // 심볼
    ethers.utils.parseEther("1000000"), // 총 공급량
    ethers.utils.parseEther("1"),       // 토큰당 가격
    ethers.utils.parseEther("100"),     // 최소 투자
    ethers.utils.parseEther("10000"),   // 최대 투자
    startTime,              // 시작 시간
    endTime                 // 종료 시간
);
```

### **2. 설정**

```solidity
// 신뢰할 수 있는 발급자 설정
await sto.setTrustedIssuer(issuerAddress, true);

// Identity Registry 설정
await sto.setIdentityRegistry(identityRegistryAddress);

// Compliance 설정
await sto.setComplianceContract(complianceAddress);

// 국가 제한 설정
await sto.setCountryRestriction(82, true);  // 한국 허용
await sto.setCountryRestriction(1, false);  // 미국 차단
```

### **3. 투자자 등록**

```solidity
// 투자자 등록
await sto.connect(trustedIssuer).registerInvestor(
    investorAddress,
    82,                                    // 국가 코드 (한국)
    true,                                  // 인증 투자자
    ethers.utils.parseEther("10000")      // 최대 투자 한도
);
```

### **4. 투자**

```solidity
// ETH로 투자
await sto.connect(investor).invest({ 
    value: ethers.utils.parseEther("1000") 
});
```

---

## 🔧 T-REX 연동

### **선택적 T-REX 연동**

SimpleSTO는 T-REX와 완전히 독립적으로 작동하지만, 필요시 T-REX의 강력한 기능들을 활용할 수 있습니다.

**T-REX 연동 시 추가 기능**:
- ✅ **고급 신원 검증**: ONCHAINID 기반 DID
- ✅ **복잡한 규제 규칙**: 모듈화된 Compliance
- ✅ **클레임 기반 검증**: ClaimTopicsRegistry
- ✅ **신뢰할 수 있는 발급자**: TrustedIssuersRegistry

### **연동 설정**

```solidity
// T-REX Identity Registry 연동
await identityRegistry.setTREXIdentityRegistry(trexIdentityRegistryAddress);

// T-REX Compliance 연동
await compliance.setTREXCompliance(trexComplianceAddress);
```

---

## 🧪 테스트

### **테스트 실행**

```bash
# 전체 테스트 실행
npx hardhat test test/hong/simple-sto.test.ts

# 특정 테스트 실행
npx hardhat test test/hong/simple-sto.test.ts --grep "투자"
```

### **테스트 커버리지**

- ✅ **배포 테스트**: 컨트랙트 배포 검증
- ✅ **관리자 기능**: 소유자 권한 검증
- ✅ **투자자 등록**: 신원 등록 프로세스
- ✅ **투자 기능**: ETH 투자 처리
- ✅ **규제 준수**: 투자 한도 및 제한 검증
- ✅ **일시정지**: 긴급 상황 대응

---

## 🔒 보안 기능

### **권한 관리**
- ✅ **Ownable**: 소유자만 관리 기능 접근
- ✅ **Trusted Issuer**: 신뢰할 수 있는 발급자만 투자자 등록
- ✅ **Pausable**: 긴급 상황 시 일시정지

### **규제 준수**
- ✅ **투자자 검증**: 등록된 투자자만 투자 가능
- ✅ **투자 한도**: 개별 및 글로벌 한도 관리
- ✅ **국가 제한**: 허용된 국가만 투자 가능
- ✅ **인증 투자자**: KYC/AML 요구사항

### **데이터 무결성**
- ✅ **이벤트 로깅**: 모든 중요 작업 이벤트 기록
- ✅ **상태 검증**: 투자 전 규제 준수 검증
- ✅ **오버플로우 방지**: SafeMath 사용

---

## 📊 모니터링

### **중요 지표**

```solidity
// STO 상태 조회
const status = await sto.getSTOStatus();
console.log("총 모집 금액:", status.totalRaised);
console.log("총 발행 토큰:", status.totalIssued);
console.log("남은 토큰:", status.remainingTokens);
console.log("남은 시간:", status.timeRemaining);
```

### **투자자 정보**

```solidity
// 투자자 정보 조회
const investor = await sto.getInvestor(investorAddress);
console.log("등록 여부:", investor.isRegistered);
console.log("국가:", investor.country);
console.log("최대 투자 한도:", investor.maxInvestment);
console.log("현재 투자 금액:", investor.currentInvestment);
console.log("인증 투자자:", investor.isAccredited);
```

---

## 🚨 주의사항

### **가스 한도**
- 대량 투자자 등록 시 가스 한도 초과 주의
- 배치 처리 시 적절한 배치 크기 설정

### **시간 설정**
- STO 시작/종료 시간은 블록체인 시간 기준
- 시간대 차이 고려 필요

### **가격 설정**
- 토큰 가격은 고정 가격 (동적 가격 미지원)
- 초기 설정 시 신중한 가격 책정 필요

### **규제 준수**
- 실제 운영 시 현지 규제 법규 준수 필요
- T-REX 연동 시 추가 규제 요구사항 확인

---

## 🔄 업그레이드

### **Proxy 패턴 지원**
- T-REX의 Proxy 패턴 활용 가능
- 업그레이드 가능한 아키텍처

### **모듈화**
- Identity Registry와 Compliance 분리
- 독립적인 업그레이드 가능

---

## 📞 지원

### **문서**
- [T-REX 백서](https://tokeny.com/wp-content/uploads/2020/05/Whitepaper-T-REX-Security-Tokens-V3.pdf)
- [ONCHAINID 문서](https://docs.onchainid.com)

### **커뮤니티**
- [T-REX GitHub](https://github.com/TokenySolutions/T-REX)
- [ONCHAINID GitHub](https://github.com/onchain-id)

---

## 📄 라이선스

이 프로젝트는 GPL-3.0 라이선스 하에 배포됩니다.

---

*SimpleSTO는 T-REX 프로토콜을 기반으로 하며, 실제 운영 시 현지 규제 법규를 준수해야 합니다.* 