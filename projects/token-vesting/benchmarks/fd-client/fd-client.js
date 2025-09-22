/* eslint-disable no-console */
/**
 * @fileoverview
 *  ForwardRequest 생성기 (buyBox 전용)
 * @description
 *  개요
 *  - 목적: TokenVesting.buyBox를 ERC-2771 Forwarder 경유로 실행하기 위한 클라이언트 스크립트
 *         ForwardRequest 페이로드를 생성, fd-server에 전달
 *  - 서명자: 구매자(PRIVATE_KEY) — forwarder 요청과 permit 모두 구매자가 서명
 *  - 주소/네트워크: benchmarks/deployment-info.json 사용
 *
 *  입출력
 *  - 입력(.env): PRIVATE_KEY, PROVIDER_URL, (선택)FD_SERVER_URL
 *  - 입력(JSON): benchmarks/deployment-info.json, benchmarks/fd-client/buyBox.json
 *  - 출력(stdout): request/options/meta JSON, curl 예시, 서버 응답(JSON)
 *
 *  처리 흐름(요약)
 *  1) 배포정보/파라미터 로드 → 컨트랙트/IFace 준비
 *  2) estimatedTotalAmount 조회 → EIP-2612 permit 서명
 *  3) buyBox calldata 생성
 *  4) ForwardRequest(EIP-712) 서명 (from=buyer)
 *  5) BigInt → string 변환 후 서버로 POST → 응답 출력
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

/**
 * @notice 파일 로더
 * - 상대 경로 기준 JSON 파일을 읽어 파싱
 * - 존재/형식 검사로 조기 실패 유도
 * @param {string} rel JSON 파일 상대경로
 * @returns {any} 파싱된 JSON 객체
 */
function loadJSON(rel) {
    const p = path.resolve(__dirname, rel);
    if (!fs.existsSync(p)) throw new Error(`❌ 파일을 찾을 수 없습니다: ${p}`);
    return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/**
 * @notice ABI 로더 (artifacts JSON에서 abi 키만 추출)
 * - Node 전용 실행을 가정
 * @param {string} rel artifacts JSON 상대경로
 * @returns {any[]} ABI 배열(Interface 생성에 사용)
 */
function loadAbi(rel) {
    const p = path.resolve(__dirname, rel);
    if (!fs.existsSync(p)) throw new Error(`❌ ABI 파일을 찾을 수 없습니다: ${p}`);
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!j.abi) throw new Error(`❌ ABI 키(abi)를 찾을 수 없습니다: ${p}`);
    return j.abi;
}

/**
 * @notice 8자 레퍼럴 보장
 * - 대문자 영문/숫자 8자 형식 보장(길이만 검사 — 상세 검증은 컨트랙트에서 수행)
 * @param {string} s 입력 문자열
 * @returns {string} 대문자 8자 문자열
 */
function ensure8CharRef(s) {
    if (typeof s !== 'string' || s.length !== 8) {
        throw new Error('❌ refCodeStr는 정확히 8자여야 합니다 (A-Z/0-9).');
    }
    return s.toUpperCase();
}

/**
 * @notice 메인 엔트리
 * @dev
 *  - 배포정보/파라미터 로드 → 컨트랙트/인터페이스 준비
 *  - permit 및 ForwardRequest 서명
 *  - 서버에 전송하고 HTTP 응답을 포맷팅 출력
 */
async function main() {
    // ---------------------------------------------------------------------
    // 1) 환경/서명자/배포정보 로드
    // ---------------------------------------------------------------------
    // ---- env ----
    const { PRIVATE_KEY, PROVIDER_URL, FD_SERVER_URL } = process.env;
    if (!PRIVATE_KEY) throw new Error('❌ .env의 PRIVATE_KEY(구매자 서명자)가 필요합니다.');

    // ---- provider & signer ----
    const provider = new ethers.JsonRpcProvider(PROVIDER_URL || 'http://127.0.0.1:8545');
    const signer   = new ethers.Wallet(PRIVATE_KEY, provider);

    // ---- load config & deployments ----
    const dep  = loadJSON('../deployment-info.json');
    const dcfg = loadJSON('./buyBox.json'); // { amount, ref, deadline, gas_call, gas_execute }

    const forwarderAddr    = dep?.forwarder;
    const tokenVestingAddr = dep?.contracts?.tokenVesting;
    const stableCoinAddr   = dep?.contracts?.stableCoin;

    if (!ethers.isAddress(forwarderAddr) || !ethers.isAddress(tokenVestingAddr) || !ethers.isAddress(stableCoinAddr)) {
        throw new Error('❌ deployment-info.json에서 forwarder/tokenVesting/stableCoin 주소를 읽지 못했습니다.');
    }

    const amount     = BigInt(dcfg?.amount ?? 0);
    const refCodeStr = ensure8CharRef(dcfg?.ref ?? '');
    if (!amount || amount <= 0n) throw new Error('❌ delegateBuyBox.json 의 amount가 유효하지 않습니다.');

    const gasCall    = BigInt(dcfg?.gas_call    ?? 1_500_000);
    const gasExecute = BigInt(dcfg?.gas_execute ?? 3_000_000);
    const deadlineIn = Number(dcfg?.deadline    ?? 3600); // seconds

    // ---------------------------------------------------------------------
    // 2) ABI/컨트랙트 준비
    // ---------------------------------------------------------------------
    // ---- load ABIs ----
    const fwdAbi   = loadAbi('../../artifacts/contracts/Forwarder.sol/WhitelistForwarder.json');
    const vestAbi  = loadAbi('../../artifacts/contracts/TokenVesting.sol/TokenVesting.json');
    const erc20Abi = loadAbi('../../artifacts/contracts/StableCoin.sol/StableCoin.json');

    const vestingIface = new ethers.Interface(vestAbi);

    // ---- contracts (RO) ----
    const vestingRO = new ethers.Contract(tokenVestingAddr, vestAbi, provider);
    const stableCoin = new ethers.Contract(stableCoinAddr, erc20Abi, provider);

    const { chainId } = await provider.getNetwork();

    // ---------------------------------------------------------------------
    // 3) 금액 산정 및 permit(EIP-2612) 서명
    // ---------------------------------------------------------------------
    const tokenName =
    (await (typeof stableCoin?.name === 'function'
        ? stableCoin.name().catch(() => undefined)
        : Promise.resolve(undefined))) ?? 'Token';
    const version =
    (await (typeof stableCoin?.version === 'function'
        ? stableCoin.version().catch(() => undefined)
        : Promise.resolve(undefined))) ?? '1';
    const estimated = await vestingRO.estimatedTotalAmount(amount, refCodeStr);
    if (estimated === 0n) throw new Error('❌ 유효하지 않은 레퍼럴 코드입니다. (estimatedTotalAmount=0)');

    const nonceERC20    = await stableCoin.nonces(signer.address);
    const permitDeadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 30); // +30m
    const permitDomain = {
        name: tokenName,
        version: version,
        chainId: Number(chainId),
        verifyingContract: stableCoinAddr,
    };
    const permitTypes = {
        Permit: [
            { name: 'owner',    type: 'address' },
            { name: 'spender',  type: 'address' },
            { name: 'value',    type: 'uint256' },
            { name: 'nonce',    type: 'uint256' },
            { name: 'deadline', type: 'uint256' },
        ],
    };
    const permitMsg = {
        owner:    signer.address,
        spender:  tokenVestingAddr,
        value:    estimated,
        nonce:    nonceERC20,
        deadline: permitDeadline,
    };
    const permitSig = await signer.signTypedData(permitDomain, permitTypes, permitMsg);
    const { v, r, s } = ethers.Signature.from(permitSig);
    const permitData = { value: estimated, deadline: permitDeadline, v, r, s };

    // ---------------------------------------------------------------------
    // 4) buyBox calldata 생성
    // ---------------------------------------------------------------------
    const callData = vestingIface.encodeFunctionData('buyBox', [amount, refCodeStr, permitData]);

    // ---------------------------------------------------------------------
    // 5) ForwardRequest(EIP-712) 서명 (from=buyer)
    //  - forwarder의 nonce는 컨트랙트에서 조회
    // ---------------------------------------------------------------------
    const forwarder = new ethers.Contract(forwarderAddr, fwdAbi, provider);
    let fwdNonce;
    try { fwdNonce = await forwarder.getNonce(signer.address); }
    catch { fwdNonce = await forwarder.nonces(signer.address); }
    fwdNonce = BigInt(fwdNonce.toString());

    const fwdDeadline = Math.floor(Date.now() / 1000) + deadlineIn; // uint48
    const domain = {
        name: 'WhitelistForwarder',
        version: '1',
        chainId: Number(chainId),
        verifyingContract: forwarderAddr,
    };
    const types = {
        ForwardRequest: [
            { name: 'from',     type: 'address' },
            { name: 'to',       type: 'address' },
            { name: 'value',    type: 'uint256' },
            { name: 'gas',      type: 'uint256' },
            { name: 'nonce',    type: 'uint256' },
            { name: 'deadline', type: 'uint48'  },
            { name: 'data',     type: 'bytes'   },
        ],
    };
    const request = {
        from:     signer.address,
        to:       tokenVestingAddr,
        value:    0n,
        gas:      gasCall,
        nonce:    fwdNonce,
        deadline: fwdDeadline,
        data:     callData,
    };
    const signature = await signer.signTypedData(domain, types, request);

    // JSON 직렬화를 위해 BigInt → string 변환 (서버에서 BigInt로 복원)
    const requestForSend = {
        ...request,
        value: request.value.toString(),
        gas: request.gas.toString(),
        nonce: request.nonce.toString(),
    };

    // 새로운 ForwardRequest 포맷: 서명 포함 단일 구조체로 묶어서 전송
    const forwardRequest = { ...requestForSend, signature };
    const payload = {
        forwardRequest,
        options: { value: request.value.toString(), gasLimit: gasExecute.toString() },
        meta: {
            chainId: Number(chainId),
            forwarder: forwarderAddr,
            endpoint: FD_SERVER_URL || 'http://127.0.0.1:3030/execute',
        },
    };

    // ---------------------------------------------------------------------
    // 6) 출력(디버깅용) + 서버 전송
    // ---------------------------------------------------------------------
    const jsonText = JSON.stringify(payload);
    const endpoint = payload.meta.endpoint;
    const curl = `echo '${jsonText.replace(/'/g, "'\\''")}' | curl -sS -H 'Content-Type: application/json' -d @- ${endpoint}`;

    // console.log(jsonText);
    // console.error('\n[copy&run] curl 명령:');
    // console.error(curl);

    // ---- 서버에 즉시 전송 (가능 시) ----
    /**
     * 서버에 JSON POST (fetch 또는 http/https 폴백)
     * @param {string} url 엔드포인트 URL
     * @param {any} body 전송할 객체(자동 JSON.stringify)
     * @returns {{status:number,statusText?:string,headers:Record<string,string>,text:string,body?:any}}
     */
    async function postJson(url, body) {
        if (typeof fetch === 'function') {
            const r = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const text = await r.text();
            const headers = {};
            try { r.headers.forEach((v, k) => { headers[k] = v; }); } catch {}
            let parsed = null;
            try { parsed = JSON.parse(text); } catch {}
            return {
                status: r.status,
                statusText: r.statusText,
                headers,
                text,
                body: parsed,
            };
        }
        // Node <18 fallback
        const { URL } = require('url');
        const u = new URL(url);
        const data = JSON.stringify(body);
        const lib = u.protocol === 'https:' ? require('https') : require('http');
        return await new Promise((resolve, reject) => {
            const req = lib.request({
                hostname: u.hostname,
                port: u.port || (u.protocol === 'https:' ? 443 : 80),
                path: u.pathname + (u.search || ''),
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(data),
                },
            }, (res) => {
                let chunks = '';
                res.setEncoding('utf8');
                res.on('data', (d) => (chunks += d));
                res.on('end', () => {
                    let parsed = null;
                    try { parsed = JSON.parse(chunks); } catch {}
                    resolve({
                        status: res.statusCode,
                        statusText: res.statusMessage,
                        headers: res.headers || {},
                        text: chunks,
                        body: parsed,
                    });
                });
            });
            req.on('error', reject);
            req.write(data);
            req.end();
        });
    }

    try {
        // 요청 전 사용자 ETH 잔액 출력
        const ethOf = async (addr) => ethers.formatEther(await provider.getBalance(addr));
        const userEthBefore = await ethOf(signer.address);
        console.log('\n⛽ ETH 잔액 (요청 전)');
        console.log(`  • user(${signer.address}): ${userEthBefore} ETH`);

        // 요청 전 사용자의 stableCoin 잔액도 출력
        const stableCoinDecimals = await stableCoin.decimals();
        const userTokenBefore = await stableCoin.balanceOf(signer.address);
        console.log('\n💵 StableCoin 잔액 (요청 전)');
        console.log(`  • user(${signer.address}): ${ethers.formatUnits(userTokenBefore, stableCoinDecimals)} token`);

        // 요청 전 TokenVesting의 StableCoin 잔액 및 buybackStableCoinAmount(user) 출력
        const TVBefore = await stableCoin.balanceOf(tokenVestingAddr);
        const buybackBefore = await vestingRO.buybackStableCoinAmount(signer.address);
        console.log('\n🏦 TokenVesting StableCoin (요청 전)');
        console.log(`  • vesting(${tokenVestingAddr}): ${ethers.formatUnits(TVBefore, stableCoinDecimals)} token`);
        console.log('\n🎁 buybackStableCoinAmount (요청 전)');
        console.log(`  • user(${signer.address}): ${ethers.formatUnits(buybackBefore, stableCoinDecimals)} token`);

        // 요청 전 refCode로 조회된 추천인 주소의 buybackStableCoinAmount 출력
        const referrerAddr = await vestingRO.getRefererByCode(refCodeStr);
        const refBuybackBefore = await vestingRO.buybackStableCoinAmount(referrerAddr);
        console.log('\n👥 Referrer (by code)');
        console.log(`  • code: ${refCodeStr}`);
        console.log(`  • addr: ${referrerAddr}`);
        console.log('\n🎁 buybackStableCoinAmount (Referrer, 요청 전)');
        console.log(`  • ref(${referrerAddr}): ${ethers.formatUnits(refBuybackBefore, stableCoinDecimals)} token`);

        const resp = await postJson(endpoint, payload);
        console.log('\n[fd-server] HTTP Response');
        const statusLine = `${resp.status}${resp.statusText ? ' ' + resp.statusText : ''}`;
        console.log(`Status: ${statusLine}`);
        console.log('Headers:');
        Object.entries(resp.headers || {}).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
        console.log('Body:');
        if (resp.body) console.log(JSON.stringify(resp.body)); else console.log(resp.text || '');

        // 요청 후 사용자 ETH 잔액 출력 (latest 블록 기준 보장)
        const userEthAfter = ethers.formatEther(await provider.getBalance(signer.address, 'latest'));
        console.log('\n⛽ ETH 잔액 (요청 후)');
        console.log(`  • user(${signer.address}): ${userEthAfter} ETH`);

        // 요청 후 사용자의 stableCoin 잔액도 출력
        const userTokenAfter = await stableCoin.balanceOf(signer.address);
        console.log('\n💵 StableCoin 잔액 (요청 후)');
        console.log(`  • user(${signer.address}): ${ethers.formatUnits(userTokenAfter, stableCoinDecimals)} token`);

        // 요청 후 TokenVesting의 StableCoin 잔액 및 buybackStableCoinAmount(user) 출력
        const vestingTokenAfter = await stableCoin.balanceOf(tokenVestingAddr);
        const buybackAfter = await vestingRO.buybackStableCoinAmount(signer.address);
        console.log('\n🏦 TokenVesting StableCoin (요청 후)');
        console.log(`  • vesting(${tokenVestingAddr}): ${ethers.formatUnits(vestingTokenAfter, stableCoinDecimals)} token`);
        console.log('\n🎁 buybackStableCoinAmount (요청 후)');
        console.log(`  • user(${signer.address}): ${ethers.formatUnits(buybackAfter, stableCoinDecimals)} token`);

        // 요청 후 refCode로 조회된 추천인 주소의 buybackStableCoinAmount 출력
        const refBuybackAfter = await vestingRO.buybackStableCoinAmount(referrerAddr);
        console.log('\n🎁 buybackStableCoinAmount (Referrer, 요청 후)');
        console.log(`  • ref(${referrerAddr}): ${ethers.formatUnits(refBuybackAfter, stableCoinDecimals)} token`);
    } catch (err) {
        console.error('\n⚠️ 서버 전송 실패:', err?.message || String(err));
        console.error('   서버가 실행 중인지 확인하세요. (node benchmarks/fd-server/index.js)');
    }
}

main().catch((e) => {
    console.error('❌ fd-client 실패:', e?.shortMessage || e?.message || e);
    process.exit(1);
});


