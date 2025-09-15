/* eslint-disable no-console */
/**
 * @fileoverview
 *  fd (fee-delegate) server 데모 파일 (express)
 * @description
 *  개요
 *  - 목적: 클라이언트가 생성한 ForwardRequest를 받아, 
 *    릴레이어(OWNER_KEY)가 ERC-2771 Forwarder.execute를 실행해주는 경량 서버
 *  - 주소/네트워크: benchmarks/deployment-info.json에서 forwarder 주소를 읽음
 *
 *  엔드포인트
 *  - GET  /          : 서버 상태 확인
 *  - POST /execute   : { request, options } → preflight → execute
 *      • request : ForwardRequest + signature (BigInt 필드 문자열화 허용)
 *      • options : { value, gasLimit } 문자열 허용
 *      • 응답    : { ok, txHash?, status?, block?, stage?, error? }
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const express = require('express');
const { ethers } = require('ethers');

/**
 * @notice Abi 파일을 읽어온다.
 * @param {*} rel Abi File path (상대경로)
 * @returns Abi Object
 */
function loadAbi(rel) {
    const p = path.resolve(__dirname, rel);
    if (!fs.existsSync(p)) throw new Error(`❌ ABI 파일을 찾을 수 없습니다: ${p}`);
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!j.abi) throw new Error(`❌ ABI 키(abi)를 찾을 수 없습니다: ${p}`);
    return j.abi;
}

/**
 * @notice Revert 메세지 디코더(간단판)
 *  - provider가 내려주는 raw hex를 interface.parseError로 시도 파싱
 * @param {unknown} e Ethers/RPC 에러 객체(내부에 revert data가 포함될 수 있음)
 * @param {Array<[string, import('ethers').Interface]>} ifaceList
 *        파싱 우선순위대로 시도할 [라벨, 인터페이스] 배열
 * @returns {string}
 *        성공 시 "Label.ErrorName" 형식의 식별자 문자열,
 *        실패 시 e.shortMessage/e.message/기본 메시지
 */
function decodeRevert(e, ifaceList) {
    const extractHex = (err) => {
        let raw = err?.info?.error?.data?.data || err?.info?.error?.data || err?.data || err?.error?.data || err?.error?.error?.data || null;
        if (!raw && typeof err?.error?.body === 'string') {
            try { const body = JSON.parse(err.error.body); raw = body?.error?.data?.data || body?.error?.data || null; } catch {}
        }
        try { if (!raw) return null; if (typeof raw === 'string') return raw; return ethers.hexlify(raw); } catch { return null; }
    };

    const asHex = extractHex(e);
    if (asHex && asHex.length >= 10) {
        for (const [lbl, iface] of ifaceList) {
            try {
                const d = iface.parseError(asHex);
                if (d?.name) {
                    // 인자 문자열 생성
                    let argsStr = '';
                    try {
                        if (d.args && d.args.length) {
                            const arr = Array.from(d.args).map((x) => String(x));
                            argsStr = `(${arr.join(', ')})`;
                            // Error(string) 인 경우는 메시지 자체만 반환(e.g. "box=0")
                            if (d.name === 'Error' && arr.length >= 1) {
                                return arr[0];
                            }
                        }
                    } catch {}
                    return `${lbl}.${d.name}${argsStr}`;
                }
            } catch {}
        }
    }
    return e?.shortMessage || e?.message || 'execution failed';
}

/**
 * @notice 비즈니스 리버트 → 적절한 HTTP 상태코드 매핑
 * @param {string} decoded decodeRevert 결과 문자열(소문자 비교로 매칭)
 * @returns {number} HTTP status code (400/403/422)
 */
function mapRevertToHttpStatus(decoded) {
    const d = (decoded || '').toLowerCase();
    if (!d) return 400; // 알 수 없는 프리플라이트 실패 → 클라이언트 입력 문제로 간주

    // 권한/정책 위반 → 403
    if (d.includes('notwhitelisted') || d.includes('selectornotallowed') || d.includes('untrustful')) {
        return 403;
    }

    // 의미적 유효성 실패(충분치 않은 잔액/허용량/서명 만료/자기추천 등) → 422
    if (
        d.includes('insufficientbalance') ||
        d.includes('insufficientallowance') ||
        d.includes('expiredsignature') ||
        d.includes('invalidsigner') ||
        d.includes('referral code not found') ||
        d.includes('self referral') ||
        d.includes('box=0') ||
        d.includes('incorrect')
    ) {
        return 422;
    }

    return 400;
}

/**
 * @notice 서버 진입점(start)
 * @dev
 *  - 환경변수 로드 → provider/relayer 초기화
 *  - ABI 로드 및 인터페이스 준비
 *  - 라우트 등록(GET /, POST /execute)
 *  - 지정 포트에서 서버 리스닝 시작
 * @env
 *  - PROVIDER_URL: JSON-RPC 엔드포인트 (기본: http://127.0.0.1:8545)
 *  - OWNER_KEY   : 릴레이어 프라이빗키 (필수)
 *  - PORT        : 서버 포트 (기본: 3030)
 */
async function start() {
    const app = express();
    app.use(express.json({ limit: '1mb' }));

    const { PROVIDER_URL, OWNER_KEY, PORT } = process.env;
    if (!OWNER_KEY) throw new Error('❌ .env의 OWNER_KEY(릴레이어 프라이빗키)가 필요합니다.');

    const provider = new ethers.JsonRpcProvider(PROVIDER_URL || 'http://127.0.0.1:8545');
    const relayer  = new ethers.Wallet(OWNER_KEY, provider);

    const fwdAbi   = loadAbi('../../artifacts/contracts/Forwarder.sol/WhitelistForwarder.json');
    const vestAbi  = loadAbi('../../artifacts/contracts/TokenVesting.sol/TokenVesting.json');
    const erc20Abi = loadAbi('../../artifacts/contracts/Usdt.sol/StableCoin.json');
    const forwarderIface = new ethers.Interface(fwdAbi);
    const vestingIface   = new ethers.Interface(vestAbi);
    const erc20Iface     = new ethers.Interface(erc20Abi);

    /**
     * @route GET /
     * @returns {object} { ok: true, msg }
     * @description 서버 상태 확인용 헬스체크 엔드포인트
     */
    app.get('/', (_req, res) => res.json({ ok: true, msg: 'fd-server alive' }));

    /**
     * @route POST /execute
     * @body
     *  - forwardRequest: { from, to, value, gas, nonce, deadline, data, signature }
     *  - options       : { value, gasLimit } (문자열 가능)
     * @returns
     *  - 성공: { ok: true, txHash, status, block }
     *  - 실패: { ok: false, stage: 'preflight'|'execute', error }
     * @description
     *  1) benchmarks/deployment-info.json에서 forwarder 주소 로드
     *  2) 문자열 BigInt 필드 복원 → preflight(staticCall)
     *  3) preflight 성공 시 execute 전송, receipt 대기 후 결과 반환
     */
    app.post('/execute', async (req, res) => {
        try {
            // 새로운 포맷: forwardRequest (서명 포함 단일 구조체)
            // 하위호환: request + signature
            const { forwardRequest, request, options } = req.body || {};
            const reqObj = forwardRequest || request;
            if (!reqObj?.to || !reqObj?.from || !reqObj?.data || !reqObj?.signature) {
                return res.status(400).json({ ok: false, error: 'invalid payload: forwardRequest/request missing fields' });
            }
            if (!ethers.isAddress(reqObj.to) || !ethers.isAddress(reqObj.from)) {
                return res.status(400).json({ ok: false, error: 'invalid address in request' });
            }

            // forwarder 주소는 benchmarks/deployment-info.json에서 읽는다
            const depPath = path.resolve(__dirname, '../deployment-info.json');
            if (!fs.existsSync(depPath)) return res.status(500).json({ ok: false, error: 'deployment-info.json not found' });
            const dep = JSON.parse(fs.readFileSync(depPath, 'utf8'));
            const forwarderAddr = dep?.forwarder;
            if (!ethers.isAddress(forwarderAddr)) return res.status(500).json({ ok: false, error: 'invalid forwarder in deployment-info.json' });

            // stringified BigInt 필드 복원
            const gasLimit = options?.gasLimit ? BigInt(options.gasLimit) : 3_000_000n;
            const value    = options?.value ? BigInt(options.value) : 0n;
            const requestFixed = {
                ...reqObj,
                value: reqObj?.value ? BigInt(reqObj.value) : 0n,
                gas: reqObj?.gas ? BigInt(reqObj.gas) : 0n,
                nonce: reqObj?.nonce ? BigInt(reqObj.nonce) : 0n,
            };

            const forwarder = new ethers.Contract(forwarderAddr, fwdAbi, relayer);

            // preflight(staticCall)
            try {
                await forwarder.execute.staticCall(requestFixed, { value, gasLimit });
            } catch (preErr) {
                // console.log(preErr)
                // console.log('--------------------------------')
                const decoded = decodeRevert(preErr, [['Forwarder', forwarderIface], ['TokenVesting', vestingIface], ['ERC20', erc20Iface]]);
                // console.log(decoded)
                const http = mapRevertToHttpStatus(decoded);
                return res.status(http).json({ ok: false, stage: 'preflight', error: decoded });
            }

            // execute(릴레이 트랜잭션)
            try {
                // 잔액(ETH) 로그: execute 전
                const ethOf = async (addr) => ethers.formatEther(await provider.getBalance(addr));
                const [relayerEthBefore, userEthBefore] = await Promise.all([
                    ethOf(relayer.address),
                    ethOf(reqObj.from),
                ]);
                console.log('\n⛽ ETH 잔액 (execute 전)');
                console.log(`  • relayer(${relayer.address}): ${relayerEthBefore} ETH`);
                console.log(`  • user   (${reqObj.from}) : ${userEthBefore} ETH`);

                const tx = await forwarder.execute(requestFixed, { value, gasLimit });
                const rc = await tx.wait();

                // 가스 비용 로그
                try {
                    const gasUsed = rc?.gasUsed ?? 0n;
                    const eff = rc?.effectiveGasPrice ?? tx?.gasPrice ?? 0n;
                    const feeWei = gasUsed * eff;
                    console.log('\n🧾 Gas Info');
                    console.log(`  • gasUsed            : ${gasUsed?.toString?.() ?? String(gasUsed)}`);
                    console.log(`  • effectiveGasPrice  : ${eff?.toString?.() ?? String(eff)} wei`);
                    console.log(`  • totalFee           : ${ethers.formatEther(feeWei)} ETH`);
                } catch {}

                // 잔액(ETH) 로그: execute 후 (해당 영수증 블록 기준으로 강제 조회)
                const blockTag = rc?.blockNumber ?? 'latest';
                const ethOfAt = async (addr, tag) => ethers.formatEther(await provider.getBalance(addr, tag));
                const [relayerEthAfter, userEthAfter] = await Promise.all([
                    ethOfAt(relayer.address, blockTag),
                    ethOfAt(reqObj.from, blockTag),
                ]);
                console.log('\n⛽ ETH 잔액 (execute 후)');
                console.log(`  • relayer(${relayer.address}): ${relayerEthAfter} ETH`);
                console.log(`  • user   (${reqObj.from}) : ${userEthAfter} ETH`);

                return res.json({ ok: true, txHash: tx.hash, status: rc.status, block: rc.blockNumber });
            } catch (err) {
                // 실패 시에도 실행 시점 잔액을 출력(대부분 변화 없음)
                try {
                    const ethOf = async (addr) => ethers.formatEther(await provider.getBalance(addr));
                    const [relayerEthAfter, userEthAfter] = await Promise.all([
                        ethOf(relayer.address),
                        ethOf(reqObj.from),
                    ]);
                    console.log('\n⛽ ETH 잔액 (execute 실패 후)');
                    console.log(`  • relayer(${relayer.address}): ${relayerEthAfter} ETH`);
                    console.log(`  • user   (${reqObj.from}) : ${userEthAfter} ETH`);
                } catch {}
                const decoded = decodeRevert(err, [['Forwarder', forwarderIface], ['TokenVesting', vestingIface], ['ERC20', erc20Iface]]);
                return res.status(500).json({ ok: false, stage: 'execute', error: decoded });
            }
        } catch (e) {
            return res.status(500).json({ ok: false, error: e?.message || String(e) });
        }
    });

    const port = Number(PORT || 3030);
    // 서버 시작 로그 (개발 편의용)
    app.listen(port, () => {
        console.log(`🚀 fd-server listening on http://127.0.0.1:${port}`);
    });
}

start().catch((e) => {
    console.error('❌ fd-server start failed:', e?.message || e);
    process.exit(1);
});


