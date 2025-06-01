# Stateful-libraries
Stateful-libraries는 Solidity에서 **라이브러리가 상태(state)를 가질 수 있도록 구성하는 다양한 패턴**을 실습하며 학습하는 교육용 프로젝트입니다.  
일반적으로 라이브러리는 상태를 갖지 않지만, `using for` 구문을 활용해 **라이브러리 내부에서 호출자의 저장소에 접근하는 방식**으로 간접적으로 상태 변경이 가능합니다.

---

## 📦 프로젝트 구조

```
projects/stateful-libraries/
├── contracts/
│ └── libs/
│     └── LibMap.sol # Stateful-libraries의 핵심 library 정의
│ └── ShipUsingLibMap.sol # LibMap 라이브러리를 실제 호출하여 동작을 확인하기 위한 컨트랙트
├── test/
│ └── ShipUsingLibMap.debug.test.js # Hardhat 기반 JS 테스트
├── foundry/
│ └── test/
│     └── ShipUsingLibMap.t.sol # Foundry 기반 Solidity 테스트
├── foundry.toml # Foundry 설정 파일
├── hardhat.config.js # Hardhat 설정 파일
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

---

## 🛠️ 설치
```bash
# 모노레포 루트에서 설치
pnpm --filter stateful-libraries install

# stateful-libraries 프로젝트로 진입하여 설치
cd projects/stateful-libraries
pnpm install
```

---

## 🧱 Compile
```bash
# 모노레포 루트에서 컴파일
pnpm --filter stateful-libraries run compile

# stateful-libraries 프로젝트로 진입하여 컴파일
cd projects/stateful-libraries
pnpm run compile

# foundry로 컴파일
cd projects/stateful-libraries/foundry
forge build
```

---

## 🧪 Test
```bash
# 모노레포 루트에서 Hardhat 테스트
pnpm --filter stateful-libraries run test

# stateful-libraries 프로젝트로 진입하여 Hardhat 테스트
cd projects/stateful-libraries
pnpm run test

# foundry로 테스트
cd projects/stateful-libraries/foundry
forge test -vv
```

---
