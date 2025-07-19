# CREATE2 Selfdestruct 공격 시나리오 테스트

이 프로젝트는 이더리움 업데이트(Cancun) 전후의 CREATE2 selfdestruct 공격 시나리오를 교육용으로 테스트합니다.

## 🎯 학습 목표

- CREATE2를 이용한 주소 예측 공격 이해
- selfdestruct 후 재배포 가능성 확인
- 이더리움 업데이트의 보안 강화 효과 체험

## 📋 테스트 시나리오

| 시나리오 | Hardhat Node | Compile | 예상 결과 | 설명 |
|---------|-------------|---------|-----------|------|
| 1 | 2.19.0 (Shanghai) | Shanghai | ✅ **성공** | 공격이 성공함 |
| 2 | 2.19.0 (Shanghai) | Cancun | ❌ **invalid opcode** | 호환성 문제 |
| 3 | 2.22.0 (Cancun) | Shanghai | ❌ **재배포 실패** | 보안 강화됨 |
| 4 | 2.22.0 (Cancun) | Cancun | ❌ **재배포 실패** | 보안 강화됨 |

## 🚀 실행 방법

### 자동화된 테스트 (권장)

```bash
# 모든 시나리오 자동 테스트
node scripts/run-with-node.js
```

이 명령어를 실행하면:
1. 각 시나리오마다 필요한 Hardhat 노드 버전을 안내
2. 새 터미널에서 해당 버전의 노드를 실행하도록 안내
3. 사용자가 노드를 실행하면 테스트 진행
4. 모든 결과를 자동으로 분석하고 요약 제공

## 📁 노드 환경 구조

```
nodes/
├── hardhat-shanghai/     # Hardhat 2.19.0 (Shanghai)
│   ├── package.json
│   ├── hardhat.config.js
│   └── node_modules/
└── hardhat-cancun/       # Hardhat 2.25.0 (Cancun)
    ├── package.json
    ├── hardhat.config.js
    └── node_modules/
```

### 노드 실행 방법

```bash
# Shanghai 노드 실행
cd nodes/hardhat-shanghai && npx hardhat node

# Cancun 노드 실행
cd nodes/hardhat-cancun && npx hardhat node
```

### 수동 테스트

```bash
# Shanghai 설정으로 테스트
cp hardhat.config.shanghai.js hardhat.config.js
npx hardhat run scripts/attack.js --network localhost

# Cancun 설정으로 테스트
cp hardhat.config.cancun.js hardhat.config.js
npx hardhat run scripts/attack.js --network localhost
```

## 🔧 환경 설정

### Hardhat Node 버전별 특징

**Hardhat 2.19.0 (Shanghai)**
- `selfdestruct` 후 주소 재사용 가능
- 공격이 성공할 수 있음

**Hardhat 2.22.0 (Cancun)**  
- `selfdestruct` 후 주소 재사용 불가능
- 공격이 차단됨

### evmVersion별 특징

**shanghai**
- Shanghai 노드에서만 실행 가능
- Cancun 노드에서도 실행 가능 (하위 호환성)

**cancun**
- Cancun 노드에서만 실행 가능
- Shanghai 노드에서는 실행 불가능

## 📚 학습 포인트

1. **CREATE2 주소 예측**: `keccak256(0xff ++ deployerAddress ++ salt ++ keccak256(initCode))`
2. **extcodehash 변경**: selfdestruct 후 재배포로 다른 extcodehash 생성
3. **보안 강화**: Cancun 업데이트로 인한 공격 차단
4. **하위 호환성**: Cancun 노드에서 Shanghai 코드 실행 가능

## ⚠️ 주의사항

- 이 프로젝트는 **교육 목적**입니다
- 실제 네트워크에서는 사용하지 마세요
- Hardhat 노드 버전에 따라 결과가 달라집니다 