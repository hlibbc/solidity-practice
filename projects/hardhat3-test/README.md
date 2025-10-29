## Hardhat Ignition 사용법 요약

### Ignition이란?
Hardhat 팀이 제공하는 선언형 배포 프레임워크입니다. `ignition/modules/*.ts`에 배포 모듈을 정의하고, 명령 한 번으로 의존성/파라미터/라이브러리 링크를 포함해 안전하게 배포합니다.

### 사전 준비
로컬 노드 실행 후 새 터미널에서 배포를 수행하세요.

```bash
pnpm -F hardhat3-test hardhat node  # 로컬 노드 실행
```

### 배포 방법
- 스크립트(권장): `package.json`에 준비된 스크립트를 사용합니다.

```bash
pnpm -F hardhat3-test run deploy:MyToken
pnpm -F hardhat3-test run deploy:App
```

- 직접 명령:

```bash
# 단건 모듈 배포
pnpm -F hardhat3-test hardhat ignition deploy ignition/modules/MyToken.ts \
  --network localhost --parameters ignition/parameters.json

# 여러 컨트랙트를 한 번에
pnpm -F hardhat3-test hardhat ignition deploy ignition/modules/App.ts \
  --network localhost --parameters ignition/parameters.json
```

### 컨트랙트 주소 기록 위치
- 기본(배포 ID 생략 시):
  - 루트 최신 배포 요약: `ignition/deployments/chain-<chainid>/deployed_addresses.json`
  - 저널: `ignition/deployments/chain-<chainid>/journal.jsonl`
  - 특징: 같은 체인에서 재배포하면 이 파일이 “최근 배포”로 덮어쓰기 됩니다.

- 배포 ID 사용 시(`--deployment-id <id>`):
  - 경로: `ignition/deployments/<id>/deployed_addresses.json`
  - 저널: `ignition/deployments/<id>/journal.jsonl`
  - 장점: 배포 결과를 컨텍스트별(ID별)로 분리 보관. 루트 최신 파일은 계속 갱신됩니다.

예시:

```bash
# 배포 결과를 app ID로 분리 보관
pnpm -F hardhat3-test hardhat ignition deploy ignition/modules/App.ts \
  --network localhost --parameters ignition/parameters.json --deployment-id app
# → 결과 파일: ignition/deployments/app/deployed_addresses.json
```

### 여러 컨트랙트를 배포하는 방법
1) 모듈 합치기: `ignition/modules/App.ts`처럼 `m.useModule()`로 필요한 모듈을 조합해 한 번에 배포합니다. 한 번의 배포 내역에 모든 컨트랙트 주소가 함께 기록됩니다.
2) 별도 배포 + 분리 보관: 각 모듈을 개별로 배포하되 `--deployment-id`를 달리 지정해 ID별 폴더에 주소를 분리 저장합니다.

### 파라미터 사용(예: MyToken)
- `ignition/parameters.json`에서 모듈별 파라미터를 제공합니다.

```json
{
  "MyTokenModule": {
    "NAME": "HongToken",
    "SYMBOL": "HONG",
    "DEPLOYER_INDEX": 0
  }
}
```

- 모듈에서는 `m.getParameter("NAME", "디폴트")`, `m.getAccount(DEPLOYER_INDEX)` 등을 사용합니다.

### 재배포/리셋
```bash
# 개발망에서 리셋 배포
pnpm -F hardhat3-test run deploy:App:reset
```

필요 시 `--reset` 옵션을 직접 명령에 추가해도 됩니다.


### Prettier 사용법 (코드 포맷)

- 설치 없이 1회 실행:

```bash
pnpm dlx prettier --write 'ignition/modules/*.ts' --tab-width 4 --use-tabs false
```

- 워크스페이스에서 패키지 필터로 실행:

```bash
pnpm -F hardhat3-test exec prettier --write 'ignition/modules/*.ts' --tab-width 4 --use-tabs false
```

- 프로젝트에 Prettier를 개발 의존성으로 설치 후 실행:

```bash
cd projects/hardhat3-test
pnpm add -D prettier
pnpm exec prettier --write 'ignition/modules/*.ts' --tab-width 4 --use-tabs false
```

- zsh 글롭 주의사항: `*.ts` 패턴은 셸이 먼저 확장하므로, 반드시 따옴표로 감싸거나 `noglob`을 사용하세요.

```bash
# 따옴표로 감싸기(권장)
pnpm -F hardhat3-test exec prettier --write 'ignition/modules/*.ts' --tab-width 4 --use-tabs false

# 혹은 일시적으로 글롭 비활성화
noglob pnpm -F hardhat3-test exec prettier --write ignition/modules/*.ts --tab-width 4 --use-tabs false
```

- 특정 파일만 지정해서 실행 예시:

```bash
pnpm -F hardhat3-test exec prettier --write \
  ignition/modules/App.ts \
  ignition/modules/LibAndUser.ts \
  ignition/modules/MyToken.ts \
  --tab-width 4 --use-tabs false
```


### Hardhat 콘솔로 배포/호출 (로컬 노드 권장)

- 노드/콘솔 실행

```bash
pnpm -F hardhat3-test exec hardhat node
# 새 터미널
pnpm -F hardhat3-test exec hardhat console --network localhost
```

- 콘솔 안(Ethers v6 JsonRpcProvider 사용)

```js
const { ethers: E } = await import("ethers");
const provider = new E.JsonRpcProvider("http://127.0.0.1:8545");
const signer = await provider.getSigner(0);

const artifact = await hre.artifacts.readArtifact("MyToken");
const factory = new E.ContractFactory(artifact.abi, artifact.bytecode, signer);
const tk = await factory.deploy("MyToken","MTK");
await tk.waitForDeployment();
await tk.getAddress();     // 배포 주소
await tk.name();           // 읽기 호출
```

- 이미 배포된 컨트랙트에 읽기 전용으로 연결

```js
const token = new E.Contract("0x...배포주소", artifact.abi, provider);
await token.name();
```

- 참고
  - 인메모리 네트워크(`--network hardhat`)에서 `hre.ethers`/`hre.viem` 확장이 환경에 따라 주입되지 않는 경우가 있어, 로컬 노드 + JsonRpcProvider 경로를 권장합니다.
