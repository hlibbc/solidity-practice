/* eslint-disable no-console */
import 'dotenv/config';
import express from 'express';
import open from 'open';
import { OAuth2Client } from 'google-auth-library';
import { ethers } from 'ethers';
// import { Web3AuthMPCCoreKit, WEB3AUTH_NETWORK } from '@web3auth/mpc-core-kit';
import { Web3AuthMPCCoreKit, WEB3AUTH_NETWORK, makeEthereumSigner } from '@web3auth/mpc-core-kit';
import { EthereumSigningProvider } from '@web3auth/ethereum-mpc-provider';
import dklsPkg from '@toruslabs/tss-dkls-lib';
const { tssLib: dklsLib } = dklsPkg;

/* ========= ENV ========= */
const ENV = {
  WEB3AUTH_CLIENT_ID: (process.env.WEB3AUTH_CLIENT_ID || '').trim(),
  WEB3AUTH_NETWORK: (process.env.WEB3AUTH_NETWORK || 'sapphire_devnet').trim().toLowerCase(),
  WEB3AUTH_VERIFIER: (process.env.WEB3AUTH_VERIFIER || '').trim(),
  GOOGLE_CLIENT_ID: (process.env.GOOGLE_CLIENT_ID || '').trim(),
  GOOGLE_CLIENT_SECRET: (process.env.GOOGLE_CLIENT_SECRET || '').trim(),
  OAUTH_REDIRECT: (process.env.OAUTH_REDIRECT || 'http://localhost:3000/callback').trim(),
  RPC_URL: (process.env.RPC_URL || 'http://127.0.0.1:8545').trim(),
  CHAIN_ID_HEX: (process.env.CHAIN_ID_HEX || '0x7A69').trim(), // 31337 (Hardhat)
};

/* ========= Quick sanity logs ========= */
const asciiOk = (s) => /^[A-Za-z0-9_-]+$/.test(s);
console.log('>>> ClientID length:', ENV.WEB3AUTH_CLIENT_ID.length, 'asciiOnly:', asciiOk(ENV.WEB3AUTH_CLIENT_ID));
console.log('>>> Network:', ENV.WEB3AUTH_NETWORK);
console.log('>>> Verifier:', ENV.WEB3AUTH_VERIFIER);

/* ========= Helpers ========= */
function toWeb3AuthNetwork(str) {
  return (str === 'sapphire_mainnet')
    ? WEB3AUTH_NETWORK.SAPPHIRE_MAINNET
    : WEB3AUTH_NETWORK.SAPPHIRE_DEVNET;
}

// Simple async in-memory storage for Node
const mem = new Map();
const memoryStorage = {
  getItem: async (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: async (k, v) => { mem.set(k, v); },
  removeItem: async (k) => { mem.delete(k); },
};

/* ========= Google OAuth: get id_token ========= */
async function getGoogleIdTokenViaOAuth() {
  if (!ENV.GOOGLE_CLIENT_ID || !ENV.GOOGLE_CLIENT_SECRET) {
    throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET 가 설정되어야 합니다.');
  }

  const app = express();
  const server = await new Promise((resolve) => {
    const s = app.listen(3000, () => resolve(s));
  });

  const oauth2Client = new OAuth2Client({
    clientId: ENV.GOOGLE_CLIENT_ID,
    clientSecret: ENV.GOOGLE_CLIENT_SECRET,
    redirectUri: ENV.OAUTH_REDIRECT,
  });

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['openid', 'email', 'profile'],
  });

  const idTokenPromise = new Promise((resolve, reject) => {
    app.get('/callback', async (req, res) => {
      try {
        const { code } = req.query;
        const { tokens } = await oauth2Client.getToken(code);
        const idToken = tokens.id_token;
        if (!idToken) throw new Error('No id_token from Google');

        // ✅ 디버그는 여기(핸들러 내부)에서!
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
        server.close();
      }
    });
  });

  await open(authUrl);
  return idTokenPromise;
}

/* ========= Web3Auth MPC login (JWT) ========= */
async function loginWeb3AuthMPC({ idToken, verifierId }) {
  if (!ENV.WEB3AUTH_CLIENT_ID) throw new Error('ENV WEB3AUTH_CLIENT_ID is empty');
  if (!asciiOk(ENV.WEB3AUTH_CLIENT_ID)) throw new Error('WEB3AUTH_CLIENT_ID 에 허용되지 않는 문자가 포함되어 있습니다.');
  if (!ENV.WEB3AUTH_VERIFIER) throw new Error('ENV WEB3AUTH_VERIFIER is empty');

  if (!dklsLib) {
    throw new Error('tssLib(dkls) 로드 실패: @toruslabs/tss-dkls-lib 설치를 확인하세요.');
  }

   // ⭐️ 네 Client ID가 Devnet에 속하므로, Devnet으로 '강제' 설정
 const chosenNetwork = WEB3AUTH_NETWORK.SAPPHIRE_DEVNET; // 또는 'sapphire_devnet' (문자열)
 console.log(chosenNetwork)
 console.log('>>> Forcing web3AuthNetwork =', chosenNetwork);
  const coreKit = new Web3AuthMPCCoreKit({
    clientId: ENV.WEB3AUTH_CLIENT_ID,
    web3AuthClientId: ENV.WEB3AUTH_CLIENT_ID,
    web3AuthNetwork: 'sapphire_devnet',        // ← 여기!
    uxMode: 'nodejs',
    tssLib: dklsLib,
    storage: memoryStorage,
    manualSync: true,
    enableLogging: false,
  });

  await coreKit.init();

  await coreKit.loginWithJWT({
    verifier: ENV.WEB3AUTH_VERIFIER,
    verifierId,
    idToken,
  });

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
 evmProvider.setupProvider(makeEthereumSigner(coreKit)); // ✅ 이것만 호출

  return { coreKit, evmProvider };
}

/* ========= Main ========= */
async function main() {
  console.log('➡️  Google OAuth 시작 (브라우저 창이 열립니다)…');
  const { idToken, verifierId, email } = await getGoogleIdTokenViaOAuth();
  console.log('✔️  Google id_token 수신, verifierId:', verifierId, 'email:', email);

  console.log('➡️  Web3Auth MPC 로그인…');
  const { coreKit, evmProvider } = await loginWeb3AuthMPC({ idToken, verifierId });

  // ethers v6: wrap EIP-1193 provider
  const browserProvider = new ethers.BrowserProvider(evmProvider);
  const signer = await browserProvider.getSigner();
  const addr = await signer.getAddress();
  console.log('👛 MPC EVM 주소:', addr);

  // Hardhat 로컬 자금 주입 및 계정 조회
  const rpc = new ethers.JsonRpcProvider(ENV.RPC_URL);
  const [funder] = await rpc.send('eth_accounts', []);
  await rpc.send('hardhat_setBalance', [addr, '0x56BC75E2D63100000']); // 100 ETH
  console.log('💧 Faucet: setBalance 완료');

  // 메시지 서명
  const sig = await signer.signMessage('hello from MPC (ethers v6, ESM)');
  console.log('✍️  signMessage:', sig);

  // 0.01 ETH 송금
  const tx = await signer.sendTransaction({ to: funder, value: ethers.parseEther('0.01') });
  console.log('🚀 송금 트랜잭션 전송:', tx.hash);
  await tx.wait();
  console.log('✅ 완료');

  await coreKit.logout();
  console.log('👋 로그아웃');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
