/**
 * 스크립트: mpc-google-cli.mjs
 * 목적: Google OAuth로 획득한 id_token(JWT)으로 Web3Auth MPC(Core Kit)에 로그인하고,
 *       로컬 Hardhat 노드에서 EVM 서명 및 송금을 빠르게 검증하기 위한 CLI 스크립트.
 *
 * 개요:
 *  - 브라우저에서 Google 로그인 → 로컬 3000 포트 콜백 수신 → id_token 검증
 *  - Web3Auth MPC(Core Kit) JWT 로그인 → EIP-1193 Provider 구성 → ethers v6 사용
 *  - 메시지 서명 및 소액 송금 트랜잭션까지 엔드투엔드 확인
 *
 * 전제조건:
 *  - Node.js v18+ 권장
 *  - pnpm 사용 환경
 *  - .env 파일에 필요한 키/설정값 존재(아래 환경변수 섹션 참고)
 *  - 로컬 Hardhat 노드 동작(또는 ENV.RPC_URL의 체인 접근 가능)
 *
 * 환경변수(.env):
 *  - WEB3AUTH_CLIENT_ID: Web3Auth에서 발급받은 Client ID (Devnet 계열 사용)
 *  - WEB3AUTH_NETWORK:  Web3auth mainnet or devnet
 *  - WEB3AUTH_VERIFIER: Web3Auth 대행 검증기 이름(예: google-verifier)
 *  - GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET: Google OAuth 클라이언트 키/시크릿
 *  - OAUTH_REDIRECT:  http://localhost:3000/callback (로컬 콜백 엔드포인트)
 *  - RPC_URL:         EVM RPC 엔드포인트 (기본값: Hardhat 로컬)
 *  - CHAIN_ID_HEX:    체인 ID(헥사, 기본: 0x7A69 = 31337)
 *
 * 실행:
 *  - pnpm node scripts/mpc-google-cli.mjs
 *
 * 참고/관련:
 *  - Web3Auth MPC Core Kit
 *  - EIP-1193 Provider, ethers v6
 *  - scripts/adhoc/vestingClaimable.js 스타일의 상세 한국어 주석 가이드
 */
/* eslint-disable no-console */

import 'dotenv/config'; // 실행 시 .env 자동 로드(프로세스의 CWD 기준)
import express from 'express'; // OAuth 콜백 서버(로컬 3000 포트)
import open from 'open'; // 기본 브라우저 열기
import { OAuth2Client } from 'google-auth-library';
import { ethers } from 'ethers';

/**
 * @description Web3Auth MPC Core Kit 관련 구성 요소
 * - Web3AuthMPCCoreKit: MPC 로그인/세션/키 파편 관리를 담당.
 * - WEB3AUTH_NETWORK:   네트워크 enum(MAINNET, DEVNET).
 * - makeEthereumSigner: Core Kit로부터 EVM 서명자를 생성하여 EthereumSigningProvider에 연결.
 */
import { Web3AuthMPCCoreKit, WEB3AUTH_NETWORK, makeEthereumSigner } from '@web3auth/mpc-core-kit';

/**
 * @description EIP-1193 규격의 EVM Provider 구현체(서명 위임용).
 */
import { EthereumSigningProvider } from '@web3auth/ethereum-mpc-provider';

/**
 * @description
 * - DKLS 기반 TSS(MPC) 구현 라이브러리 (ECDSA secp256k1 서명 지원).
 * - 해당 패키지는 CommonJS(CJS)이므로 named import가 불가.
 *   default로 전체를 들여온 뒤, 내부의 tssLib만 구조분해하여 사용.
 *
 * CJS 예시:
 *   const dklsPkg = require('@toruslabs/tss-dkls-lib');
 *   const dklsLib = dklsPkg.tssLib;
 */
import dklsPkg from '@toruslabs/tss-dkls-lib';
const { tssLib: dklsLib } = dklsPkg;

/* ========= ENV ========= */
/**
 * @notice 실행에 필요한 환경변수 모음(일부 기본값 제공).
 * - 실제 배포용/테스트용 값은 .env에서 주입됩니다.
 */
const ENV = {
    WEB3AUTH_CLIENT_ID: process.env.WEB3AUTH_CLIENT_ID,
    WEB3AUTH_NETWORK: process.env.WEB3AUTH_NETWORK,
    WEB3AUTH_VERIFIER: process.env.WEB3AUTH_VERIFIER,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    OAUTH_REDIRECT: process.env.OAUTH_REDIRECT,
    RPC_URL: process.env.RPC_URL,
    CHAIN_ID_HEX: process.env.CHAIN_ID_HEX
};

/**
 * @notice 간단한 Client ID 유효성 체크(ASCII 안전 문자만 허용).
 * - 초기 설정 검증 로그로도 활용.
 */
const asciiOk = (s) => /^[A-Za-z0-9_-]+$/.test(s);

/**
 * @notice Node 런타임용 간이 비동기 메모리 스토리지.
 * - 브라우저의 localStorage 대체 개념(프로세스 생명주기 동안만 유지).
 * - Core Kit의 storage 어댑터로 넘겨 세션/메타데이터 유지에 사용.
 */
const mem = new Map();
const memoryStorage = {
    getItem: async (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: async (k, v) => {
        mem.set(k, v);
    },
    removeItem: async (k) => {
        mem.delete(k);
    },
};

/* ========= Google OAuth: get id_token ========= */
/**
 * @notice Google OAuth를 통해 id_token(JWT)을 획득
 *
 * 동작 개요:
 *  1) 로컬 Express 서버를 3000 포트로 기동
 *  2) Google OAuth consent 화면으로 이동
 *  3) 콜백(/callback)에서 code 수신 → 토큰 교환 → id_token 추출
 *  4) id_token을 검증하여 aud/sub/email을 확인
 *
 * 반환값:
 *  - Promise<{ idToken: string; verifierId: string; email?: string }>
 *    · verifierId: Web3Auth에서 사용자 식별에 사용할 subject(sub)
 *
 * 예외:
 *  - GOOGLE_CLIENT_ID/SECRET 미설정 시 Error
 *  - Google에서 id_token 미반환 시 Error
 */
async function getGoogleIdTokenViaOAuth() {
    if (!ENV.GOOGLE_CLIENT_ID || !ENV.GOOGLE_CLIENT_SECRET) {
        throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET 가 설정되어야 합니다.');
    }

    // 콜백 수신용 임시 서버 기동
    const app = express();
    const server = await new Promise((resolve) => {
        const s = app.listen(3000, () => resolve(s));
    });

    // OAuth2 클라이언트 초기화(클라ID/시크릿/리다이렉트 포함)
    const oauth2Client = new OAuth2Client({
        clientId: ENV.GOOGLE_CLIENT_ID,
        clientSecret: ENV.GOOGLE_CLIENT_SECRET,
        redirectUri: ENV.OAUTH_REDIRECT,
    });

    // 동의 화면 URL 구성
    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: ['openid', 'email', 'profile'],
    });

    // /callback 경로에서 code 수신 → 토큰 교환 → id_token 검증
    const idTokenPromise = new Promise((resolve, reject) => {
        app.get('/callback', async (req, res) => {
            try {
                const { code } = req.query;
                const { tokens } = await oauth2Client.getToken(code);
                const idToken = tokens.id_token;
                if (!idToken) {
                    throw new Error('No id_token from Google');
                }
                // id_token의 aud(클라ID 일치) 포함 페이로드 검증
                const ticket = await oauth2Client.verifyIdToken({
                    idToken,
                    audience: ENV.GOOGLE_CLIENT_ID,
                });
                const payload = ticket.getPayload();
                console.log('id_token aud from Google:', payload.aud);

                resolve({ idToken, verifierId: payload.sub, email: payload.email });
                res.send('Google login success! You can close this tab.');
            } catch (e) {
                reject(e);
                res.status(500).send('OAuth failed');
            } finally {
                // 요청 처리 후 서버 종료(임시 서버이므로 생명주기 짧게 관리)
                server.close();
            }
        });
    });

    // 기본 브라우저에 동의 화면 오픈
    await open(authUrl);
    return idTokenPromise;
}

/* ========= Web3Auth MPC login (JWT) ========= */
/**
 * @notice Google id_token과 verifierId(sub)를 사용해 Web3Auth MPC(Core Kit) 로그인
 *
 * 파라미터:
 *  - { idToken: string; verifierId: string }
 *
 * 동작 개요:
 *  1) 사전 유효성 검사(ENV 값 및 DKLS TSS 라이브러리 로드 확인)
 *  2) Core Kit 인스턴스 초기화(init)
 *  3) loginWithJWT(verifier, verifierId, idToken) 호출
 *  4) EthereumSigningProvider 구성(EIP-1193) + makeEthereumSigner(coreKit) 연결
 *
 * 반환값:
 *  - Promise<{ coreKit: Web3AuthMPCCoreKit; evmProvider: EthereumSigningProvider }>
 *
 * 예외:
 *  - 환경변수 누락/부적합, DKLS 로드 실패 시 Error
 */
async function loginWeb3AuthMPC({ idToken, verifierId }) {
    if (!ENV.WEB3AUTH_CLIENT_ID) {
        throw new Error('ENV WEB3AUTH_CLIENT_ID is empty');
    }
    if (!asciiOk(ENV.WEB3AUTH_CLIENT_ID)) {
        throw new Error('WEB3AUTH_CLIENT_ID 에 허용되지 않는 문자가 포함되어 있습니다.');
    }
    if (!ENV.WEB3AUTH_VERIFIER) {
        throw new Error('ENV WEB3AUTH_VERIFIER is empty');
    }
    if (!dklsLib) {
        throw new Error('tssLib(dkls) 로드 실패: @toruslabs/tss-dkls-lib 설치를 확인하세요.');
    }

    // Devnet Client ID 기준, 네트워크를 Devnet으로 '강제' 설정
    const chosenNetwork = (ENV.WEB3AUTH_NETWORK == 'MAINNET')? (WEB3AUTH_NETWORK.MAINNET) : (WEB3AUTH_NETWORK.DEVNET);

    // Core Kit 인스턴스 생성
    const coreKit = new Web3AuthMPCCoreKit({
        clientId: ENV.WEB3AUTH_CLIENT_ID,
        web3AuthClientId: ENV.WEB3AUTH_CLIENT_ID,
        web3AuthNetwork: chosenNetwork,
        uxMode: 'nodejs',
        tssLib: dklsLib, // DKLS 기반 TSS 라이브러리
        storage: memoryStorage, // 세션/메타데이터 보관(storage 어댑터)
        manualSync: true, // 필요 시 수동 동기화
        enableLogging: false, // SDK 내부 로그 최소화
    });

    // SDK 초기화 및 JWT 로그인
    await coreKit.init();
    await coreKit.loginWithJWT({
        verifier: ENV.WEB3AUTH_VERIFIER,
        verifierId,
        idToken,
    });

    // EIP-1193 Provider 구성(EVM 체인 연결 정보 포함)
    const evmProvider = new EthereumSigningProvider({
        config: {
            chainConfig: {
                chainNamespace: 'eip155',
                chainId: ENV.CHAIN_ID_HEX,
                rpcTarget: ENV.RPC_URL,
                displayName: 'Local Hardhat',
                ticker: 'ETH',
                tickerName: 'Ethereum',
            },
        },
    });

    // Core Kit 서명자 → Provider에 연결(핵심 연결 포인트)
    evmProvider.setupProvider(makeEthereumSigner(coreKit));

    return { coreKit, evmProvider };
}

/* ========= Main ========= */
/**
 * @notice 전체 흐름을 순차 실행하는 엔트리 포인트
 *
 * 시퀀스:
 *  1) Google OAuth로 id_token, verifierId(sub), email 수신
 *  2) Web3Auth MPC 로그인(Core Kit + EIP-1193 Provider 준비)
 *  3) ethers v6 BrowserProvider 래핑 → Signer/Address 확인
 *  4) 로컬 Hardhat에 Faucet(잔액 주입) → 메시지 서명 → 소액 송금
 *  5) 완료 후 Core Kit 로그아웃
 *
 * 사이드 이펙트:
 *  - 로컬 3000 포트 사용(임시 서버)
 *  - ENV.RPC_URL 네트워크에 잔액 주입 및 트랜잭션 브로드캐스트
 */
async function main() {
    console.log('➡️  Google OAuth 시작 (브라우저 창이 열립니다)…');
    const { idToken, verifierId, email } = await getGoogleIdTokenViaOAuth();
    console.log('✔️  Google id_token 수신, verifierId:', verifierId, 'email:', email);

    console.log('➡️  Web3Auth MPC 로그인…');
    const { coreKit, evmProvider } = await loginWeb3AuthMPC({ idToken, verifierId });

    // ethers v6: EIP-1193 Provider 래핑 → 표준 Signer 획득
    const browserProvider = new ethers.BrowserProvider(evmProvider);
    const signer = await browserProvider.getSigner();

    // MPC 기반 EVM 주소 확인
    const addr = await signer.getAddress();
    console.log('👛 MPC EVM 주소:', addr);

    // Hardhat 로컬 자금 주입 및 계정 조회
    // - funder: 로컬 노드의 첫 번째 계정
    // - setBalance: 테스트 편의상 대상 주소에 큰 잔액 주입(100 ETH)
    const rpc = new ethers.JsonRpcProvider(ENV.RPC_URL);
    const [funder] = await rpc.send('eth_accounts', []);
    await rpc.send('hardhat_setBalance', [addr, '0x56BC75E2D63100000']); // 100 ETH
    console.log('💧 Faucet: setBalance 완료');

    // 메시지 서명(오프체인 서명 예시)
    const sig = await signer.signMessage('hello from MPC (ethers v6, ESM)');
    console.log('✍️  signMessage:', sig);

    // 소액 송금(0.01 ETH) 트랜잭션 전송 → 확정 대기
    const tx = await signer.sendTransaction({ to: funder, value: ethers.parseEther('0.01') });
    console.log('🚀 송금 트랜잭션 전송:', tx.hash);
    await tx.wait();
    console.log('✅ 완료');

    // 세션 정리
    await coreKit.logout();
    console.log('👋 로그아웃');
}

// 실행 엔트리
main().catch((e) => {
    console.error(e);
    process.exit(1);
});