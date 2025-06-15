# Bypassing-extcodesize
이 프로젝트는 Solidity의 `extcodesize` 기반 계약 여부 검사 로직을 우회(bypassing)하는 방법을 실습하고 검증하기 위한 테스트용 샘플입니다. 아래 내용을 포커스로 다룹니다:

- **Basilisk** 컨트랙트의 `enter()` 함수에서 사용하는 `extcodesize(msg.sender)` 검사 이해  
- 생성자 단계에서 `extcodesize == 0` 을 이용해 컨트랙트 호출을 EOA처럼 속이는 공격 기법 구현  
- `Attacker` 컨트랙트를 통해 `enter()` → `slay()` 흐름을 자동화하고, `isSlain` 상태 변화를 검증  
- Hardhat 및 Foundry 환경에서 통합 테스트 작성  
- Solidity의 저수준 어셈블리(`extcodesize`) 동작 원리와 보안 취약점 학습  

이 프로젝트를 통해 EVM의 코드 크기 검사 메커니즘과, 이를 우회하는 실제 구현 및 테스트 과정을 체험할 수 있습니다.

---

## 📦 프로젝트 구조

```
projects/bypassing-extcodesize/
├── contracts/
│ └── interfaces/
│     └── IChallenger.sol # Challenge interface 정의
│ └── Attacker.sol # Basilisk 컨트랙트를 실제 우회공격 하기위한 Attacker 컨트랙트
│ └── Basilisk.sol # extcodesize 우회공격 테스트를 위한 컨트랙트
├── test/
│ └── BasiliskAttack.debug.test.js # Hardhat 기반 JS 테스트
├── foundry/
│ └── test/
│     └── BasiliskAttack.t.sol # Foundry 기반 Solidity 테스트
├── package.json
└── README.md
```

---

## ⚙️ 개발 환경
- Node,js (v22.14)
- pnpm (v10.6.5)
- hardhat (v2.22.0)
- ethers.js (v6.13.5)
- foundry (forge Version: 1.0.0-stable)
- @openzeppelin/contracts (v5.2.0)

---

## 🛠️ 설치
```bash
# 모노레포 루트에서 설치
pnpm --filter bypassing-extcodesize install

# bypassing-extcodesize 프로젝트로 진입하여 설치
cd projects/bypassing-extcodesize
pnpm install
```

---

## 🧱 Compile
```bash
# 모노레포 루트에서 컴파일
pnpm --filter bypassing-extcodesize run compile

# bypassing-extcodesize 프로젝트로 진입하여 컴파일
cd projects/bypassing-extcodesize
pnpm run compile

# foundry로 컴파일
cd projects/bypassing-extcodesize/foundry
forge build
```

---

## 🧪 Test
```bash
# 모노레포 루트에서 Hardhat 테스트
pnpm --filter bypassing-extcodesize run test

# bypassing-extcodesize 프로젝트로 진입하여 Hardhat 테스트
cd projects/bypassing-extcodesize
pnpm run test

# foundry로 테스트
cd projects/bypassing-extcodesize/foundry
forge test -vv
```

---

