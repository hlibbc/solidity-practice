# ZK-SNARK Basic Arithmetic Circuits

이 프로젝트는 **Zero-Knowledge Proofs (ZK-SNARKs)**의 기본 개념을 학습하기 위한 산술 연산 회로들의 모음입니다. Circom을 사용하여 간단한 수학 연산을 ZK-SNARK 회로로 구현하고, Groth16 프로토콜을 통해 증명을 생성하고 검증합니다.

## 🎯 프로젝트 목표

- ZK-SNARK의 기본 개념 이해
- Circom을 사용한 회로 설계 방법 학습
- Groth16 프로토콜을 통한 증명 생성 및 검증 과정 이해
- Solidity 스마트 컨트랙트에서 ZK 증명 검증 방법 학습

## 🏗️ 프로젝트 구조

```
zk-01_basic-arithmetic/
├── circuits/                    # Circom 회로 파일들
│   ├── addition.circom         # 덧셈 회로
│   ├── subtraction.circom      # 뺄셈 회로
│   ├── multiplication.circom   # 곱셈 회로
│   └── division.circom         # 나눗셈 회로
├── contracts/                   # 생성된 Solidity 검증자 컨트랙트들
│   ├── addition_Verifier.sol
│   ├── subtraction_Verifier.sol
│   ├── multiplication_Verifier.sol
│   ├── division_Verifier.sol
│   └── Example.sol
├── scripts/                     # 빌드 및 배포 스크립트
│   └── build.sh               # 메인 빌드 스크립트
├── build/                      # 빌드 출력 디렉토리
├── foundry/                    # Foundry 테스트
├── test/                       # Hardhat 테스트
├── hardhat.config.js           # Hardhat 설정
├── foundry.toml               # Foundry 설정
└── package.json               # 프로젝트 의존성
```

## 🚀 시작하기

### 사전 요구사항

- Node.js 18+ 
- pnpm (권장) 또는 npm
- Circom 2.x
- snarkjs

### 설치

```bash
# 의존성 설치
pnpm install

# 또는 npm 사용
npm install
```

### 빌드

```bash
# 기본 회로 (addition) 빌드
pnpm run build

# 특정 회로 빌드
pnpm run build multiplication
pnpm run build division
pnpm run build subtraction

# 또는 직접 스크립트 실행
bash scripts/build.sh [circuit_name]
```

## 📚 구현된 회로들

### 1. Addition (덧셈)
```circom
template Addition() {
    signal input a;
    signal input b;
    signal output c;
    
    c <== a + b;
}
```
- **입력**: `a`, `b` (두 정수)
- **출력**: `c = a + b`
- **용도**: 기본 덧셈 연산의 ZK 증명

### 2. Subtraction (뺄셈)
```circom
template Subtraction() {
    signal input a;
    signal input b;
    signal output c;
    
    c <== a - b;
}
```
- **입력**: `a`, `b` (두 정수)
- **출력**: `c = a - b`
- **용도**: 기본 뺄셈 연산의 ZK 증명

### 3. Multiplication (곱셈)
```circom
template Multiplication() {
    signal input a;
    signal input b;
    signal output c;
    
    c <== a * b;
}
```
- **입력**: `a`, `b` (두 정수)
- **출력**: `c = a * b`
- **용도**: 기본 곱셈 연산의 ZK 증명

### 4. Division (나눗셈)
```circom
template Division() {
    signal input a;
    signal input b;
    signal input q;
    signal input r;
    signal output valid;
    
    valid <== (a == b * q + r) && (r < b);
}
```
- **입력**: `a` (피제수), `b` (제수), `q` (몫), `r` (나머지)
- **출력**: `valid` (나눗셈이 올바른지 여부)
- **용도**: 나눗셈 연산의 정확성 검증

## 🔧 빌드 과정

`scripts/build.sh` 스크립트는 다음 단계를 수행합니다:

1. **회로 컴파일**: Circom으로 `.circom` 파일을 R1CS, WASM, 심볼 테이블로 컴파일
2. **Powers of Tau 설정**: 신뢰할 수 있는 설정을 위한 공개 매개변수 생성
3. **Groth16 설정**: proving key와 verification key 생성
4. **샘플 입력 생성**: 각 회로에 맞는 테스트 입력값 자동 생성
5. **증명 생성**: witness 계산, 증명 생성, 검증
6. **Solidity 검증자 생성**: 블록체인에서 사용할 수 있는 검증자 컨트랙트 생성

## 🧪 테스트

### Hardhat 테스트
```bash
pnpm run test
```

### Foundry 테스트
```bash
cd foundry
forge test
```

## 📖 학습 포인트

### ZK-SNARK 기본 개념
- **Zero-Knowledge**: 증명자가 비밀 정보를 공개하지 않고도 진실을 증명
- **Succinct**: 증명 크기가 작고 검증이 빠름
- **Non-interactive**: 증명자와 검증자 간 상호작용 불필요

### Circom 회로 설계
- **Template**: 재사용 가능한 회로 컴포넌트
- **Signal**: 회로의 입력, 출력, 중간값을 나타내는 변수
- **Constraint**: 회로의 논리적 관계를 정의하는 제약조건

### Groth16 프로토콜
- **Setup**: 신뢰할 수 있는 설정 단계
- **Prove**: 증명 생성 단계
- **Verify**: 증명 검증 단계

## 🌐 온체인 검증

생성된 `*_Verifier.sol` 컨트랙트들은 이더리움과 같은 블록체인에 배포하여 ZK 증명을 온체인에서 검증할 수 있습니다.

```solidity
// 배포된 검증자 컨트랙트 사용 예시
Verifier verifier = Verifier(verifierAddress);
bool isValid = verifier.verifyTx(proof, publicInputs);
```

## 📁 주요 파일 설명

- **`circuits/*.circom`**: ZK-SNARK 회로 정의
- **`contracts/*_Verifier.sol`**: 자동 생성된 Solidity 검증자
- **`scripts/build.sh`**: 전체 빌드 프로세스 자동화
- **`pot12_*.ptau`**: Powers of Tau 공개 매개변수 파일들

## 🔗 관련 링크

- [Circom 공식 문서](https://docs.circom.io/)
- [SnarkJS 문서](https://github.com/iden3/snarkjs)
- [ZK-SNARK 개념 설명](https://z.cash/technology/zksnarks/)

## 📝 라이선스

이 프로젝트는 교육 목적으로 제작되었습니다.

---

**참고**: 이 프로젝트는 ZK-SNARK의 기본 개념을 이해하기 위한 학습용 예제입니다. 실제 프로덕션 환경에서는 보안 감사를 거쳐야 합니다.
