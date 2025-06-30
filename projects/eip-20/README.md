# Eip-20
Eip-20 프로젝트는 새로운 체인에서 빠르게 EIP-20 토큰을 올려볼 수 있도록 하기 위한 용도로 구현한 EIP-20 표준 프로젝트입니다.


---

## 📦 프로젝트 구조

```
projects/eip-20/
├── contracts/
│ └── MyToken.sol # 표준 ERC20 토큰 구현
├── scripts/
│ └── deploy.js # 배포 스크립트
├── test/
│ └── MyToken.debug.test.js # Hardhat 기반 JS 테스트
├── hardhat.config.js # Hardhat 설정 파일
├── package.json
└── README.md
```

---

## ⚙️ 개발 환경
- Node.js (권장 v22 이상)
- pnpm (권장 v10 이상)
- hardhat (v2.22.0)
- @openzeppelin/contracts (v5.2.0)
- dotenv (v16.0.0)

---

## 🛠️ 설치
```bash
# 모노레포 루트에서 설치
pnpm --filter eip-20 install

# eip-20 프로젝트로 진입하여 설치
cd projects/eip-20
pnpm install
```

---

## 🧱 Compile
```bash
# 모노레포 루트에서 컴파일
pnpm --filter eip-20 run compile

# eip-20 프로젝트로 진입하여 컴파일
cd projects/eip-20
pnpm run compile
```

---

## 🧪 Test
```bash
# 모노레포 루트에서 Hardhat 테스트
# 모노레포 루트에서 Hardhat 테스트
pnpm --filter eip-20 run test

# eip-20 프로젝트로 진입하여 Hardhat 테스트
cd projects/eip-20
pnpm run test
```

---
