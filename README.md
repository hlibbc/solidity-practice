# Solidity-practice
이 프로젝트는 Solidity 학습용 스마트컨트랙트 예제 모음입니다.

---

## 📦 프로젝트 구조
pnpm 기반 모노레포 형식으로 구현되어 있으며, 서브 프로젝트 목록은 아래와 같습니다.

| 프로젝트                            | 설명                                                         |
| ----------------------------------- | ------------------------------------------------------------ |
| [eip-1271](./projects/eip-1271)     | 스마트 컨트랙트 기반 서명 검증 표준 ([ERC-1271](https://eips.ethereum.org/EIPS/eip-1271)) 실습 |
| [eip-2612](./projects/eip-2612)     | [ERC-2612](https://eips.ethereum.org/EIPS/eip-2612) Permit 방식의 서명 기반 토큰 승인 실습              |
| [eip-712](./projects/eip-712)       | [ERC-712](https://eips.ethereum.org/EIPS/eip-712) 구조화된 데이터 서명 실습                             |
| [eip-4337](./projects/eip-4337)     | [ERC-4337](https://eips.ethereum.org/EIPS/eip-4337) Account Abstraction 및 EntryPoint 기반 지갑 실습     |

---

## ⚙️ 개발 환경
- Node,js (v22.14)
- pnpm (v10.6.5)

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

# 특정 하위 프로젝트로 진입하여 의존성 설치
cd <프로젝트 폴더명>
pnpm run compile
```

---

## 🧪 Test
```bash
# 모노레포 루트에서 특정 하위 프로젝트 테스트
pnpm --filter <프로젝트 명> run test

# 특정 하위 프로젝트로 진입하여 의존성 설치
cd <프로젝트 폴더명>
pnpm run test
```

---

