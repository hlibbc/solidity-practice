# Meta-Transaction Project

이 프로젝트는 Ethereum에서 메타트랜잭션(Meta-Transaction)을 구현한 예제입니다. 사용자가 가스비를 지불하지 않고도 스마트 컨트랙트와 상호작용할 수 있도록 합니다.

## 🚀 주요 기능

### **1. 메타트랜잭션 실행**
- 사용자가 서명한 트랜잭션을 릴레이어가 대신 실행
- 가스비는 릴레이어가 부담
- EIP-2771 표준 준수

### **2. 화이트리스트 기반 접근 제어**
- 허가된 주소만 메타트랜잭션 실행 가능
- 동적 화이트리스트 관리 (추가/제거)
- 소유권 기반 권한 관리

### **3. 배치 처리**
- 여러 메타트랜잭션을 한 번에 실행
- 가스 효율성 향상
- 부분 실패 허용 (일부 성공, 일부 실패)

### **4. 고급 에러 처리**
- 원본 컨트랙트의 revert reason을 그대로 전파
- 상세한 에러 로깅
- 디버깅 친화적인 구조

## 📁 프로젝트 구조

```
projects/meta-transaction/
├── contracts/
│   ├── MyForwarder.sol          # 메인 포워더 컨트랙트
│   │   ├── MyDefaultForwarder   # 기본 메타트랜잭션 포워더
│   │   └── MyWhitelistForwarder # 화이트리스트 기반 포워더
│   ├── MetaTxReceiver.sol       # 메타트랜잭션 수신자
│   └── Refunder.sol             # 환불 처리 컨트랙트
├── test/
│   └── MyForwarder.test.js      # 포워더 테스트 (기본 + 화이트리스트)
├── scripts/
│   ├── deploy.js                 # 컨트랙트 배포
│   ├── deployContracts.js        # 전체 배포 스크립트
│   └── signAndRelay.js          # 서명 및 릴레이
└── README.md                     # 이 파일
```

## 🏗️ 아키텍처

### **컨트랙트 관계**
```
User (Signer) → MyWhitelistForwarder → MyDefaultForwarder → MetaTxReceiver
     ↓                    ↓                    ↓              ↓
   서명 생성        화이트리스트 검증      요청 검증 및 실행   실제 로직 실행
```

### **핵심 컴포넌트**
1. **MyDefaultForwarder**: EIP-2771 표준을 확장한 기본 포워더
2. **MyWhitelistForwarder**: 화이트리스트 기반 접근 제어를 추가한 포워더
3. **MetaTxReceiver**: 메타트랜잭션을 받아 처리하는 컨트랙트
4. **Refunder**: 가스비 환불을 처리하는 컨트랙트

### **상속 구조**
```
ERC2771Forwarder (OpenZeppelin)
        ↓
  MyDefaultForwarder
        ↓
  MyWhitelistForwarder
```

## 🔧 설치 및 실행

### **의존성 설치**
```bash
pnpm install
```

### **테스트 실행**
```bash
pnpm --filter meta-transaction run test
```

### **컨트랙트 배포**
```bash
pnpm --filter meta-transaction run deploy
```

## 📝 사용법

### **1. 메타트랜잭션 생성**
```javascript
const request = {
    from: userAddress,
    to: contractAddress,
    value: 0,
    gas: 300000,
    deadline: Math.floor(Date.now() / 1000) + 3600,
    data: encodedFunctionData,
    signature: "0x"
};
```

### **2. 서명 생성**
```javascript
const signature = await signer.signTypedData(domain, types, request);
const signedRequest = { ...request, signature };
```

### **3. 릴레이 실행**
```javascript
// 기본 포워더 사용
const tx = await defaultForwarder.connect(relayer).execute(signedRequest);

// 화이트리스트 포워더 사용
const tx = await whitelistForwarder.connect(relayer).execute(signedRequest);
```

### **4. 화이트리스트 관리**
```javascript
// 화이트리스트에 주소 추가
await whitelistForwarder.connect(owner).addToWhitelist(targetAddress);

// 화이트리스트에서 주소 제거
await whitelistForwarder.connect(owner).removeFromWhitelist(targetAddress);

// 배치로 여러 주소 추가
await whitelistForwarder.connect(owner).addBatchToWhitelist([addr1, addr2, addr3]);
```

## 🧪 테스트 케이스

### **MyDefaultForwarder 테스트**
- ✅ 정상적인 메타트랜잭션 실행
- ✅ 잘못된 서명 처리
- ✅ 만료된 요청 처리
- ✅ 타겟 컨트랙트 revert 처리
- ✅ revert reason bubbling

### **MyWhitelistForwarder 테스트**
- ✅ 화이트리스트 관리 (추가/제거/배치)
- ✅ 소유권 관리 (이전/포기)
- ✅ 화이트리스트된 주소만 실행 허용
- ✅ 화이트리스트되지 않은 주소 거부
- ✅ revert reason bubbling 유지

### **배치 실행 테스트**
- ✅ 여러 요청 동시 처리
- ✅ 부분 실패 시나리오
- ✅ 가스비 불일치 처리

## 🔒 보안 기능

### **1. 서명 검증**
- EIP-712 표준 준수
- Nonce 기반 replay attack 방지
- 만료 시간 검증

### **2. 화이트리스트 기반 접근 제어**
- 허가된 주소만 메타트랜잭션 실행
- 소유자만 화이트리스트 관리 가능
- 배치 작업으로 효율적인 관리

### **3. 권한 관리**
- 서명자 주소 검증
- 가스 한계 설정
- 가스비 환불 메커니즘
- 소유권 이전 및 포기 기능

### **4. 에러 처리**
- 원본 revert reason 보존
- 상세한 에러 로깅
- 안전한 실패 처리

## 🌟 주요 특징

### **1. EIP-2771 표준 준수**
- OpenZeppelin의 ERC2771Forwarder 상속
- 표준 인터페이스 구현
- 호환성 보장

### **2. 화이트리스트 기반 보안**
- 동적 접근 제어
- 효율적인 주소 관리
- 배치 작업 지원

### **3. 고급 에러 처리**
- 원본 컨트랙트 에러 전파
- 상세한 에러 정보 제공
- 디버깅 친화적 구조

### **4. 가스 최적화**
- 배치 처리로 가스 효율성 향상
- 불필요한 상태 변경 최소화
- 효율적인 메모리 사용

## 🚨 주의사항

### **1. Nonce 관리**
- 각 요청마다 고유한 nonce 사용
- 순차적 nonce 증가 필수
- 서명 검증 실패 방지

### **2. 화이트리스트 관리**
- 소유자만 화이트리스트 수정 가능
- 제로 주소 추가/제거 방지
- 배치 작업 시 가스 한계 고려

### **3. 가스비 계산**
- 릴레이어의 가스비 부담
- 적절한 가스 한계 설정
- 환불 메커니즘 고려

### **4. 보안 고려사항**
- 서명 검증의 중요성
- 만료 시간 설정
- 권한 관리
- 화이트리스트 우회 방지

## 🔍 주요 함수

### **MyWhitelistForwarder**
```solidity
// 화이트리스트 관리
function addToWhitelist(address target) external onlyOwner
function removeFromWhitelist(address target) external onlyOwner
function addBatchToWhitelist(address[] calldata targets) external onlyOwner
function removeBatchFromWhitelist(address[] calldata targets) external onlyOwner
function isWhitelisted(address target) external view returns (bool)

// 소유권 관리
function transferOwnership(address newOwner) external onlyOwner
function renounceOwnership() external onlyOwner

// 메타트랜잭션 실행
function execute(ForwardRequestData calldata request) public payable override
```

### **MyDefaultForwarder**
```solidity
// 단일 메타트랜잭션 실행
function execute(ForwardRequestData calldata request) public payable virtual override

// 배치 메타트랜잭션 실행
function executeBatch(ForwardRequestData[] calldata requests) public payable
```

## 🤝 기여하기

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 라이선스

이 프로젝트는 MIT 라이선스 하에 배포됩니다. 자세한 내용은 [LICENSE](LICENSE) 파일을 참조하세요.

## 📞 문의

프로젝트에 대한 질문이나 제안사항이 있으시면 이슈를 생성해 주세요.

---

**Happy Meta-Transactioning! 🚀**
