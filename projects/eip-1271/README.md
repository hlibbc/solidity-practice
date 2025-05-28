# EIP-1271 Smartcontract Wallet
[EIP-1271](https://eips.ethereum.org/EIPS/eip-1271)은 스마트 컨트랙트 계정이 서명을 검증할 수 있도록 표준화한 인터페이스입니다.  
이 프로젝트는 EOA의 EIP-712 서명을 스마트 월렛이 `isValidSignature`를 통해 검증하는 과정을 다룹니다.

---

## 📦 프로젝트 구조

```
projects/eip-1271/
├── contracts/
│ └── MySmartWallet.sol # EIP-1271 구현 스마트월렛
├── test/
│ └── MySmartWallet.test.js # Hardhat 기반 JS 테스트 (EIP-712 서명 검증)
├── scripts/
│ └── eip712_eth-sig-util.js # eth-sig-util 기반 서명 생성 및 digest 확인 유틸
│ └── eip712_ethersv6.js # ethers.js v6 기반 서명 및 digest 유틸
├── foundry/
│ └── test/
│     └── MySmartWallet.t.sol # Foundry 기반 Solidity 테스트
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
- @metamask/eth-sig-util (v8.2.0)
- foundry (forge Version: 1.0.0-stable)

---

## 🛠️ 설치
```bash
# 모노레포 루트에서 설치
pnpm --filter eip-1271 install

# eip-1271 프로젝트로 진입하여 설치
cd projects/eip-1271
pnpm install
```

---

## 🧱 Compile
```bash
# 모노레포 루트에서 컴파일
pnpm --filter eip-1271 run compile

# eip-1271 프로젝트로 진입하여 컴파일
cd projects/eip-1271
pnpm run compile

# foundry로 컴파일
cd projects/eip-1271/foundry
forge build
```

---

## 🧪 Test
```bash
# 모노레포 루트에서 Hardhat 테스트
pnpm --filter eip-1271 run test

# eip-1271 프로젝트로 진입하여 Hardhat 테스트
cd projects/eip-1271
pnpm run test

# foundry로 테스트
cd projects/eip-1271/foundry
forge test -vv
```

---

## 🚀 Script 실행
- scripts/eip712_eth-sig-util.js
    - @metamask/eth-sig-util을 사용하여 EIP-712 타입 데이터 구조로 digest를 생성하고, 개인키로 서명합니다.
    ```bash
    # 모노레포 루트에서 실행
    pnpm --filter eip-1271 exec node scripts/eip712_eth-sig-util.js

    # eip-1271 프로젝트로 진입하여 실행
    cd projects/eip-1271
    node scripts/eip712_eth-sig-util.js
    ```
- scripts/eip712_ethersv6.js
    - ethers.js v6의 TypedDataEncoder를 사용하여 digest 계산 및 서명 생성을 수행합니다.
    ```bash
    # 모노레포 루트에서 실행
    pnpm --filter eip-1271 exec node scripts/eip712_ethersv6.js

    # eip-1271 프로젝트로 진입하여 실행
    cd projects/eip-1271
    node scripts/eip712_ethersv6.js
    ```

---