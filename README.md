# Solidity-practice
이 프로젝트는 Solidity 학습용 스마트컨트랙트 예제 모음입니다.

---

## 📦 프로젝트 구조
pnpm 기반 모노레포 형식으로 구현되어 있으며, 서브 프로젝트 목록은 아래와 같습니다.

| 프로젝트                            | 설명                                                         |
| ----------------------------------- | ------------------------------------------------------------ |
| [breaking-rng](./projects/breaking-rng)     | Random Number Generation의 취약점들 사례 분석 |
| [chainlink-vrf](./projects/chainlink-vrf)     | Chainlink-VRF 테스트 및 실습 |
| [eip-1271](./projects/eip-1271)     | [EIP-1271](https://eips.ethereum.org/EIPS/eip-1271) 기반 스마트컨트랙트 Wallet 표준 실습 |
| [eip-2612](./projects/eip-2612)     | Permit ([EIP-2612](https://eips.ethereum.org/EIPS/eip-2612) ) 방식의 서명 기반 토큰 승인 실습 |
| [eip-4337](./projects/eip-4337)     | [EIP-4337](https://eips.ethereum.org/EIPS/eip-4337) Account Abstraction 및 EntryPoint 기반 지갑 실습 |
| [event-advanced](./projects/event-advanced)     | 이벤트 구독패턴 원리 이해를 위한 교육용 예제 |
| [meta-transaction](./projects/meta-transaction)     | [EIP-2771](https://eips.ethereum.org/EIPS/eip-2771) 기반 Meta-transaction 실습 |
| [nested-struct-sig](./projects/nested-struct-sig)       | [EIP-712](https://eips.ethereum.org/EIPS/eip-712) 기반 Custom structure 데이터 서명 실습 |
| [stateful-libraries](./projects/stateful-libraries)       | Stateful-libraries 동작 분석 및 실습 |
| [storage-layout](./projects/storage-layout)       | 각 타입별 변수들이 storage의 slot에 저장되는 방식 확인 |

---

## ⚙️ 개발 환경
- Node,js (v22.14)
- pnpm (v10.6.5)

---

## 프로젝트 생성
```bash
node create-sub-solidity-proj.js <프로젝트명>
```
- Hardhat, Foundry, Openzeppelin libs 등 solidity 개발 환경 자동 설치
    - Hardhat (2.22.0)
    - Openzeppelin (5.2)
    - dotenv (16.0)

---

## 🛠️ 의존성 설치
```bash
# 모노레포 루트에서 전체 하위 프로젝트 의존성 설치
pnpm -r install

# 모노레포 루트에서 특정 하위 프로젝트의 의존성 설치
pnpm --filter <프로젝트 명> install

# 특정 하위 프로젝트로 진입하여 의존성 설치
cd <프로젝트 폴더명>
pnpm install
```

---

## 🧱 Compile
```bash
# 모노레포 루트에서 특정 하위 프로젝트의 solidity 코드 컴파일
pnpm --filter <프로젝트 명> run compile

# 특정 하위 프로젝트로 진입하여 solidity 코드 컴파일
cd <프로젝트 폴더명>
pnpm run compile
```

---

## 🧪 Test
```bash
# 모노레포 루트에서 특정 하위 프로젝트 테스트
pnpm --filter <프로젝트 명> run test

# 특정 하위 프로젝트로 진입하여 테스트
cd <프로젝트 폴더명>
pnpm run test
```

---

