# Breaking-Rng
Breaking-Rng는 Solidity에서 흔히 사용되는 RNG(Random Number Generator) 구현 방식의 취약점을 이해하고 직접 실습해볼 수 있는 교육용 프로젝트입니다.
block.timestamp 기반 랜덤값 예측, blockhash 기반의 commit-reveal 패턴 무력화 등 다양한 공격 시나리오를 Hardhat 및 Foundry 테스트를 통해 재현하고 학습합니다.

- Shadeling
    - block.timestamp를 이용해 계산된 해시를 “무작위 값”으로 사용하는 잘못된 RNG 예제
    - 동일 블록 내에서 공격자가 keccak256(abi.encode(block.timestamp))를 예측하여 predict() 호출 시 isPredicted를 true로 만드는 방법을 테스트로 검증

- ElderShadeling
    - commit-reveal 방식으로 blockhash를 “랜덤값”으로 사용하는 두 번째 예제
    - 커밋된 시점(blockNumber = N)으로부터 256블록 이후에는 blockhash(N+1)이 0x0이 되어버리는 EVM 특성을 악용해 checkPrediction()을 무력화하는 방법을 실습

---

## 📦 프로젝트 구조

```
projects/breaking-rng/
├── contracts/
│ └── ElderShadeling.sol # 256블록 이후에는 blockhash(N+1)이 0x0이 되어버리는 EVM 특성을 악용한 Rng 위험성 예시 컨트랙트
│ └── Shadeling.sol # block.timestamp를 이용한 Rng 위험성 예시 컨트랙트
├── test/
│ └── ElderShadeling.debug.test.js # Hardhat 기반 ElderShadeling 테스트
│ └── HackShadeling.debug.test.js # Hardhat 기반 Shadeling 테스트
├── foundry/
│ └── test/
│     └── ElderShadeling.t.sol # Foundry 기반 ElderShadeling 테스트
│     └── HackShadeling.t.sol # Foundry 기반 hadeling 테스트
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
pnpm --filter breaking-rng install

# breaking-rng 프로젝트로 진입하여 설치
cd projects/breaking-rng
pnpm install
```

---

## 🧱 Compile
```bash
# 모노레포 루트에서 컴파일
pnpm --filter breaking-rng run compile

# breaking-rng 프로젝트로 진입하여 컴파일
cd projects/breaking-rng
pnpm run compile

# foundry로 컴파일
cd projects/breaking-rng/foundry
forge build
```

---

## 🧪 Test
```bash
# 모노레포 루트에서 Hardhat 테스트
pnpm --filter breaking-rng run test

# breaking-rng 프로젝트로 진입하여 Hardhat 테스트
cd projects/breaking-rng
pnpm run test

# foundry로 테스트
cd projects/breaking-rng/foundry
forge test -vv
```

---
