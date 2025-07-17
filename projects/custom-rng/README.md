# Custom RNG (Random Number Generator)

커스텀 난수 생성기 프로젝트입니다. 이 프로젝트는 블록체인에서 안전하고 검증 가능한 난수를 생성하기 위한 스마트 컨트랙트 시스템을 구현합니다.

## 📋 목차

- [개요](#개요)
- [아키텍처](#아키텍처)
- [컨트랙트 설명](#컨트랙트-설명)
- [설치 및 실행](#설치-및-실행)
- [테스트](#테스트)
- [보안 고려사항](#보안-고려사항)
- [라이센스](#라이센스)

## 🎯 개요

이 프로젝트는 블록체인 환경에서 사용할 수 있는 커스텀 난수 생성기(RNG)를 구현합니다. 주요 특징은 다음과 같습니다:

- **서명 기반 검증**: EIP-712를 사용한 서명 검증으로 난수의 무결성 보장
- **다단계 엔트로피**: 라운드 진행 중 추가 엔트로피를 통한 예측 불가능성 확보
- **투명성**: 모든 과정이 블록체인에 기록되어 검증 가능
- **분리된 아키텍처**: Main 컨트랙트와 Rng 컨트랙트의 역할 분리

## 🏗️ 아키텍처

### 컨트랙트 구조

```
Main.sol (라운드 관리)
├── 라운드 생명주기 관리
├── Rng 컨트랙트와의 상호작용
└── 상태 관리

Rng.sol (난수 생성)
├── 서명 검증
├── 엔트로피 추가
└── 최종 난수 생성
```

### 라운드 생명주기

1. **NotStarted** → 라운드 시작 전
2. **Proceeding** → 라운드 진행 중 (startRound)
3. **Drawing** → 개표 중 (endRound)
4. **Claiming** → 당첨금 수령 중 (settleRound)
5. **Ended** → 종료

## 📄 컨트랙트 설명

### Main.sol

라운드의 전체 생명주기를 관리하는 메인 컨트랙트입니다.

#### 주요 기능

- `startRound(uint256 _roundId, bytes calldata _signature)`: 라운드 시작
- `endRound(uint256 _roundId)`: 라운드 종료 및 엔트로피 추가
- `settleRound(uint256 _roundId, uint256 _randSeed)`: 라운드 정산 및 최종 난수 확정
- `getRoundStatus(uint256 _roundId)`: 라운드 상태 조회

### Rng.sol

실제 난수 생성을 담당하는 컨트랙트입니다.

#### 주요 기능

- `commit(uint256 _roundId, bytes calldata _signature)`: 서명된 시드 저장
- `sealEntropy(uint256 _roundId, address _ender)`: 엔트로피 추가
- `reveal(uint256 _roundId, uint256 _randSeed)`: 최종 난수 생성 및 검증

#### 난수 생성 과정

1. **Commit 단계**: 서명된 시드 저장
2. **Seal 단계**: 블록 해시를 이용한 엔트로피 추가
3. **Reveal 단계**: 서명 검증 후 최종 난수 생성

```
최종 난수 = keccak256(
    시드 + 종료자주소 + 솔트 + 엔트로피1 + 엔트로피2
)
```

## 🚀 설치 및 실행

### 필수 요구사항

- Node.js 18+
- pnpm (권장) 또는 npm
- Foundry (테스트용)

### 설치

```bash
# 의존성 설치
pnpm install

# Foundry 설치 (선택사항)
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

### 컴파일

```bash
# Hardhat으로 컴파일
pnpm compile

# Foundry로 컴파일 (선택사항)
forge build
```

### 배포

```bash
# 로컬 네트워크 실행
npx hardhat node

# 배포
pnpm deploy
```

## 🧪 테스트

### Hardhat 테스트

```bash
# 모든 테스트 실행
pnpm test

# 특정 테스트 실행
npx hardhat test test/Main.debug.test.js
npx hardhat test test/Rng.debug.test.js
npx hardhat test test/Integration.debug.test.js
```

### Foundry 테스트

```bash
# 모든 테스트 실행
forge test

# 특정 테스트 실행
forge test --match-contract Main
forge test --match-contract Rng
forge test --match-contract Integration

# 가스 사용량과 함께 테스트
forge test --gas-report
```

## 🔒 보안 고려사항

### 서명 검증

- EIP-712 표준을 사용한 타입 안전한 서명 검증
- 서명자 주소 검증으로 무단 접근 방지

### 엔트로피 소스

- 블록 해시를 이용한 추가 엔트로피
- 다중 엔트로피 소스로 예측 불가능성 확보
- 과거 블록 해시 사용으로 조작 방지

### 접근 제어

- `onlyOwner` 수정자로 관리자 기능 보호
- `onlyMain` 수정자로 Rng 컨트랙트 접근 제한

## 📦 프로젝트 구조

```
custom-rng/
├── contracts/
│   ├── Main.sol          # 라운드 관리 컨트랙트
│   └── Rng.sol           # 난수 생성 컨트랙트
├── test/
│   ├── Main.debug.test.js
│   ├── Rng.debug.test.js
│   └── Integration.debug.test.js
├── foundry/
│   └── test/
│       ├── Main.t.sol
│       ├── Rng.t.sol
│       └── Integration.t.sol
├── hardhat.config.js
├── foundry.toml
└── package.json
```

## 🔧 설정

### Hardhat 설정

- Solidity 버전: 0.8.28
- EVM 버전: Cancun (0.8.28+ 지원)
- 최적화: 활성화 (200 runs)

### Foundry 설정

- 소스 디렉토리: `contracts/`
- 테스트 디렉토리: `foundry/test/`
- 출력 디렉토리: `foundry/out/`

## 📝 사용 예시

### 1. 컨트랙트 배포

```javascript
// Main 컨트랙트 배포
const Main = await ethers.getContractFactory("Main");
const main = await Main.deploy();

// Rng 컨트랙트 배포
const Rng = await ethers.getContractFactory("Rng");
const rng = await Rng.deploy(main.address, signer.address);

// Main 컨트랙트에 Rng 주소 설정
await main.setContracts([rng.address]);
```

### 2. 라운드 실행

```javascript
// 1. 라운드 시작
await main.startRound(1, signature);

// 2. 라운드 종료
await main.endRound(1);

// 3. 라운드 정산
await main.settleRound(1, originalSeed);
```

## 🤝 기여

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 라이센스

이 프로젝트는 MIT 라이센스 하에 배포됩니다. 자세한 내용은 [LICENSE](../LICENSE) 파일을 참조하세요.

## 👨‍💻 작성자

**hlibbc**

---

**주의**: 이 프로젝트는 교육 및 연구 목적으로 제작되었습니다. 프로덕션 환경에서 사용하기 전에 충분한 보안 감사를 받으시기 바랍니다. 