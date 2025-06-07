# Chainlink-vrf
이 프로젝트는 Chainlink VRF (Verifiable Random Function) v2.5를 활용하여, 랜덤값을 안전하게 온체인으로 가져오고 활용하는 과정을 실습하고 검증하기 위한 테스트 프로젝트입니다.
- 주요 목적
    - Chainlink VRF v2.5 기반 난수 요청 및 응답 구조 이해
    - subscription 기반 consumer 등록 및 fulfillment 흐름 실습
    - `WizardTower` 컨트랙트를 통해 VRF 응답 결과를 저장하고 검증
    - VRF 응답이 완료될 때까지 대기하거나 사용자가 수동으로 확인할 수 있는 스크립트 구성

---

## 📦 프로젝트 구조

```
projects/chainlink-vrf/
├── contracts/
│ └── WizardTower.sol # Chainlink-Vrf 테스트를 위한 컨트랙트
├── scripts/
│ └── check-vrf.js # WizardTower 배포 및 consumer 등록, vrf call, fulfillment 확인
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
- @chainlink/contracts (v1.4.0)

---

## 🛠️ 설치
```bash
# 모노레포 루트에서 설치
pnpm --filter chainlink-vrf install

# chainlink-vrf 프로젝트로 진입하여 설치
cd projects/chainlink-vrf
pnpm install
```

---

## 🧱 Compile
```bash
# 모노레포 루트에서 컴파일
pnpm --filter chainlink-vrf run compile

# chainlink-vrf 프로젝트로 진입하여 컴파일
cd projects/chainlink-vrf
pnpm run compile

# foundry로 컴파일
cd projects/chainlink-vrf/foundry
forge build
```

---

## Script 실행 (check-vrf.js)
check-vrf.js는 Chainlink VRF v2.5의 작동을 테스트하고 검증하기 위한 스크립트입니다. 아래의 단계를 수행합니다.
1. 환경변수 로딩
    .env 파일에서 subscription ID, keyHash, gas limit, payment 방식 등을 로드합니다.
2. WizardTower 스마트 컨트랙트 배포
    Chainlink VRF 요청을 포함한 테스트용 컨트랙트를 배포합니다.
3. Subscription에 consumer 등록
    배포한 컨트랙트를 해당 subscription의 consumer로 등록합니다.
4. 등록 여부 Polling 확인
    등록이 완료될 때까지 1초 간격으로 최대 50초간 상태를 확인합니다.
5. climb() 함수 호출
    VRF 랜덤 값을 요청하는 climb() 함수를 호출하고, 응답 결과를 저장합니다.
6. 사용자 입력을 통해 결과 확인
    사용자가 엔터를 누르면 floorsClimbed() 결과를 출력하고, q를 입력하면 종료됩니다.

.env 파일 (projects/chainlink-vrf/) 에 아래 환경변수가 설정되어 있어야 합니다:
```bash
# Chainlink-vrf coordinator Info (Sepolia)
VRF_COORDINATOR=

# Chainlink-vrf subscription Info
### KEY-HASH
KEYHASH=
### SUBSCRIPTION-ID
SUBSCRIPTION_ID=
### REQUEST-CONFIRMATION: VRF 완결성 (블록에 실리고 추가로 몇블록 뒤에 "완결"되었음으로 인지하고 처리할지? 보통 3 ~ 5 값을 쓴다고 함)
REQUEST_CONFIRMATION=
### CALLBACK_GAS_LIMIT (VRF tx 처리 gas 설정: 넉넉히 250만)
CALLBACK_GAS_LIMIT=

# Native-payment 여부 (true이면 비용이 ETH로 계산됨, false이면 LINK로 계산됨)
NATIVE_PAYMENT=
```


---

## 🧪 Chainlink VRF subscription 생성 및 충전
1. [Chainlink-VRF](https://vrf.chain.link/sepolia) 접속 후 subscription 생성능
    - Key-hash와 Subscription ID 필수 저장
2. 생성된 subscription 페이지에서 "Fund Subscription" 버튼 클릭하여 ETH와 LINK를 충전
3. "Add Consumer" 버튼을 클릭하여 필요에 따라 consumer 추가 가능

---

## ✅ Chainlink VRF v2 vs v2.5 비교
| 항목                     | VRF v2 (`VRFConsumerBaseV2`) | VRF v2.5 (`VRFConsumerBaseV2Plus`)             |
| ---------------------- | ---------------------------- | ---------------------------------------------- |
| **Subscription ID 타입** | `uint64`                     | `uint256` (더 많은 구독 ID 범위 허용)                   |
| **결제 방식**              | LINK만 가능                     | LINK 또는 Native Token (e.g. ETH) 선택 가능          |
| **Native Payment 지원**  | ❌                            | ✅ `nativePayment: true`로 설정 가능                 |
| **RandomWords 요청 방식**  | 개별 파라미터 전달                   | `RandomWordsRequest` 구조체로 통합 전달                |
| **확장성 (ExtraArgs)**    | 없음                           | ✅ `ExtraArgsV1` 구조체로 확장성 고려                    |
| **구현 라이브러리**           | `VRFConsumerBaseV2.sol`      | `VRFConsumerBaseV2Plus.sol`, `VRFV2PlusClient` |
| **수수료 계산 기반**          | LINK 가격 기준                   | Native token 기준 시 더 직관적인 계산 가능                 |
| **기존 subscription 호환** | ✅                            | ✅ (단, ID 타입에 주의 필요)                            |

---
