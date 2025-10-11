# Web3Auth MPC Google CLI (ethers v6)

Google 계정(OIDC **id_token**)으로 Web3Auth **MPC Core Kit**에 로그인해 **EVM 주소를 만들고**, **메시지 서명**, **트랜잭션 전송**까지 한 번에 실행하는 CLI 예제입니다.  
Node.js(ESM), ethers v6, `@web3auth/mpc-core-kit`, `@web3auth/ethereum-mpc-provider`, DKLS TSS를 사용합니다.

> 기본 제공 스크립트: `scripts/mpc-google-cli.mjs`

---

## ✨ 기능 개요

- Google OAuth 2.0 로그인 (로컬 3000 포트 콜백)
- 구글 **id_token**으로 Web3Auth **MPC Core Kit** 로그인 (Custom JWT Verifier)
- MPC EVM 주소 조회
- (기본) Hardhat 로컬 노드에 잔액 주입 후 메시지 서명 & 0.01 ETH 송금

---

## ✅ 사전 준비(Prerequisites)

- Node.js **v20+** 권장 (예: v22)
- npm 또는 pnpm (모노레포라면 pnpm 추천)
- Web3Auth 계정 / 대시보드 접근
- Google Cloud Console 접근 (OAuth 2.0 클라이언트 생성)

---

## 1) Google Cloud Console에서 OAuth 2.0 클라이언트 만들기
(https://console.cloud.google.com/)

1. **Google Cloud Console** → **APIs & Services** → **Credentials** 이동  
2. (처음이라면) **OAuth consent screen** 설정(내부/외부, 앱 정보 최소 입력)  
3. **Create Credentials** → **OAuth client ID**  
   - **Application type**: **Web application**  
   - **Authorized redirect URIs**: `http://localhost:3000/callback` 추가  
   - 생성 후 **Client ID**와 **Client Secret**을 기록

> 이 값이 `.env`의 `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OAUTH_REDIRECT`가 됩니다.

---

## 2) Web3Auth 대시보드에서 Client ID & Custom JWT Verifier 만들기
(https://dashboard.web3auth.io/)

1. **Web3Auth Dashboard** 로그인
2. 프로젝트 생성 또는 선택 → **Project Settings**에서 **Client ID** 복사  
   - 이 값이 `.env`의 `WEB3AUTH_CLIENT_ID`
3. 좌측 **Authentication → Custom Connections → Custom**  
   - **Add connection**으로 **Custom JWT Verifier** 생성
   - **Auth Connection ID**: 예) `mpc-test-0002`  
     → `.env`의 `WEB3AUTH_VERIFIER`로 사용
   - **JWKS Endpoint**: `https://www.googleapis.com/oauth2/v3/certs`
   - **JWT user identifier**: `sub`
   - **Select fields to validate** (최대 3개):
     - `iss = https://accounts.google.com`
     - `aud = <당신의 GOOGLE_CLIENT_ID>`  ← (위 1)에서 만든 **본인** Web application Client ID)
     - (선택) `email_verified = true`
   - 저장 후 **Enabled** 확인


---

## 3) 패키지 설치

### (모노레포 예시) `web3auth-mpc` 워크스페이스에 설치
```bash
pnpm -F web3auth-mpc add   @toruslabs/tss-dkls-lib   @web3auth/ethereum-mpc-provider   @web3auth/mpc-core-kit   ethers@^6   express   open   google-auth-library   dotenv
```
> npm 사용 시: `npm i`로 동일 패키지 설치

---

## 4) 환경변수(.env) 작성

프로젝트(또는 해당 워크스페이스) 루트에 `.env` 생성:

```env
# Web3Auth
WEB3AUTH_CLIENT_ID=대시보드_클라이언트_ID
WEB3AUTH_NETWORK=DEVNET
WEB3AUTH_VERIFIER=mpc-test-0002

# Google OAuth (Web application)
GOOGLE_CLIENT_ID=구글_OAuth_Client_ID
GOOGLE_CLIENT_SECRET=구글_OAuth_Client_Secret
OAUTH_REDIRECT=http://localhost:3000/callback

# EVM (Hardhat 로컬)
RPC_URL=http://127.0.0.1:8545
CHAIN_ID_HEX=0x7A69
```

> **모노레포에서 .env 로드**  
> - `pnpm -F web3auth-mpc run ...` 으로 실행하면 해당 패키지 폴더의 `.env`가 로드됩니다.  
> - 루트에서 직접 실행한다면 `node --env-file=packages/web3auth-mpc/.env ...` 로 명시 가능.  
> - 코드 상단은 `import 'dotenv/config'` 사용 중입니다.

---

## 5) 스크립트 위치 & 실행 스크립트 추가

- 파일: `scripts/mpc-google-cli.mjs` (이미 존재한다고 가정)
- `package.json`(해당 워크스페이스)에 스크립트 추가:
```json
{
  "type": "module",
  "scripts": {
    "mpc:cli": "node scripts/mpc-google-cli.mjs"
  }
}
```

### 실행

#### (옵션) Hardhat 로컬 노드
```bash
npx hardhat node
```

#### CLI 실행
```bash
pnpm -F web3auth-mpc run mpc:cli
# 또는
npm run mpc:cli
```

- 브라우저가 열리고, Google 로그인 → 동의 → 콜백되면 콘솔에 진행 상황이 표시됩니다.
- 성공 시:
  - **MPC EVM 주소**가 출력
  - Hardhat 노드에 잔액 주입
  - 메시지 서명(signature) 출력
  - 0.01 ETH 송금 트랜잭션 전송/확인

---

## 6) 테스트넷/메인넷으로 전환 (선택)

하드햇 대신 테스트넷(예: Sepolia) 사용하려면 `.env`만 변경:

```env
RPC_URL=https://sepolia.infura.io/v3/<키>   # 또는 Alchemy 등
CHAIN_ID_HEX=0xaa36a7
```

그리고 **Hardhat 전용 메서드**(`hardhat_setBalance`) 호출 부분은 주석 처리/삭제하세요.

> 메인넷 사용 시에도 RPC/체인ID만 변경하면 됩니다.  
> Web3Auth Client ID의 네트워크(Devnet/Mainnet)와 코드 초기화 네트워크가 **반드시 일치**해야 합니다.

---

## 7) 동작 원리(요약)

1. `express`로 로컬 콜백 서버(3000) 띄움
2. `open(authUrl)`로 기본 브라우저에서 Google 로그인
3. 콜백에서 `code`로 토큰 교환 → **id_token** 획득 & 검증
4. `loginWithJWT({ verifier, verifierId: sub, idToken })`로 Web3Auth MPC 로그인
5. `EthereumSigningProvider` + `makeEthereumSigner(coreKit)`로 EIP-1193 provider 구성
6. `new ethers.BrowserProvider(evmProvider)`로 ethers v6 래핑 → `signer` 획득
7. 주소/서명/트랜잭션 수행

---

## 8) Troubleshooting

- **`clientId invalid` / 길이 0**  
  → `.env` 로드 실패 또는 공백/개행 포함. `.env` 경로/포맷 확인, `console.log`로 값 체크.

- **`Client network mismatch`**  
  → 대시보드 Client ID가 **Devnet**인데 코드에서 **Mainnet**으로 초기화(또는 반대).  
    본 예제는 `web3AuthNetwork: 'sapphire_devnet'`로 문자열 고정.

- **`aud validation failed`**  
  → Verifier의 `aud`가 **Playground(407408...)** 또는 엉뚱한 값.  
    반드시 **본인 `GOOGLE_CLIENT_ID`** 로 설정.

- **`Verifier not supported`**  
  → Verifier 이름 오타/비활성/다른 프로젝트/Archived.  
    대시보드에서 Auth Connection ID 정확히 확인 & Enabled 상태.

- **`Cannot read properties of undefined (reading 'keyType')`**  
  → `tssLib` 미주입. `@toruslabs/tss-dkls-lib` 설치/임포트 확인:
    ```js
    import dklsPkg from '@toruslabs/tss-dkls-lib';
    const { tssLib: dklsLib } = dklsPkg;
    // coreKit 옵션에 tssLib: dklsLib
    ```

- **`evmProvider.init is not a function`**  
  → 최신 API는 `init()` 대신:
    ```js
    evmProvider.setupProvider(makeEthereumSigner(coreKit));
    ```

- **`chainConfig` 관련 에러**  
  → `EthereumSigningProvider` 생성자 인자는 아래 형태여야 함:
    ```js
    new EthereumSigningProvider({
      config: { chainConfig: { /* ... */ } }
    })
    ```

- **브라우저가 안 열림**  
  → 서버/WSL 등 GUI 없는 환경일 수 있음. `authUrl`만 콘솔에 찍고 수동 오픈하거나, 환경에 맞게 플로우 조정.

---

## 9) 보안/운영 메모

- `id_token` 원문은 **로그로 남기지 말 것** (디버깅 시 `aud` 정도만).
- 실제 서비스에선 **백업/복구(Recovery) 전략** 고려 (`manualSync`, 복구팩터 등).
- 비밀값은 `.env`로 관리하고, 저장소에 커밋하지 않도록 주의.

---

## 10) 모노레포에서 .env 로드 팁

- 패키지 스크립트로 실행하면 해당 패키지의 `.env`가 자동 로드됩니다:
  ```bash
  pnpm -F web3auth-mpc run mpc:cli
  ```
- 루트에서 직접 경로 실행 시 경로 명시:
  ```bash
  node --env-file=packages/web3auth-mpc/.env packages/web3auth-mpc/scripts/mpc-google-cli.mjs
  ```
  (`import 'dotenv/config'` 없이도 동작)
