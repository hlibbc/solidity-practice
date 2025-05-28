# Storage-layout
Storage-layout은 Solidity에서 변수들이 EVM의 storage slot에 어떻게 저장되는지를 실습을 통해 학습할 수 있는 교육용 프로젝트입니다.
static type, dynamic type, array, mapping, double mapping 등의 다양한 변수 타입이 실제로 어떤 방식으로 배치되고 저장되는지를 Hardhat과 Foundry 기반 테스트를 통해 확인합니다.

---

## 📦 프로젝트 구조

```
projects/storage-layout/
├── contracts/
│ └── StorageLayoutExplanation.sol # StorageLayoutExplanation 컨트랙트
├── test/
│ └── StorageLayoutExplanation.debug.test.js # Hardhat 기반 JS 테스트
├── foundry/
│ └── test/
│     └── StorageLayoutExplanation.t.t.sol # Foundry 기반 Solidity 테스트
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
pnpm --filter storage-layout install

# storage-layout 프로젝트로 진입하여 설치
cd projects/storage-layout
pnpm install
```

---

## 🧱 Compile
```bash
# 모노레포 루트에서 컴파일
pnpm --filter storage-layout run compile

# storage-layout 프로젝트로 진입하여 컴파일
cd projects/storage-layout
pnpm run compile

# foundry로 컴파일
cd projects/storage-layout/foundry
forge build
```

---

## 🧪 Test
```bash
# 모노레포 루트에서 Hardhat 테스트
pnpm --filter storage-layout run test

# storage-layout 프로젝트로 진입하여 Hardhat 테스트
cd projects/storage-layout
pnpm run test

# foundry로 테스트
cd projects/storage-layout/foundry
forge test -vv
```

---
