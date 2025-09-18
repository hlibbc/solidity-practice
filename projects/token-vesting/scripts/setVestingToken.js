/**
 * @fileoverview
 *  Token 컨트랙트를 배포한 뒤 TokenVesting에 vestingToken을 설정하고,
 *  .env의 BUY/REF 풀 총합을 계산하여 필요한 양의 토큰을 Vesting으로 전송합니다.
 *
 * 실행:
 *   pnpm exec hardhat run scripts/setVestingToken.js --network <network>
 *
 * 환경변수(../.env):
 *   OWNER_KEY           : 배포/운영 지갑 프라이빗키 (필수)
 *   PROVIDER_URL        : RPC URL (선택, 기본 http://localhost:8545)
 *   BUY_POOL1_AMOUNT    : 구매 풀 1 총량(토큰 "개수" 단위, 구분자 허용)
 *   BUY_POOL2_AMOUNT    : 구매 풀 2 총량(토큰 "개수" 단위, 구분자 허용)
 *   BUY_POOL3_AMOUNT    : 구매 풀 3 총량(토큰 "개수" 단위, 구분자 허용)
 *   BUY_POOL4_AMOUNT    : 구매 풀 4 총량(토큰 "개수" 단위, 구분자 허용)
 *   REF_POOL1_AMOUNT    : 추천인 풀 1 총량(토큰 "개수" 단위, 구분자 허용)
 *   REF_POOL2_AMOUNT    : 추천인 풀 2 총량(토큰 "개수" 단위, 구분자 허용)
 *   REF_POOL3_AMOUNT    : 추천인 풀 3 총량(빈 값이면 0 처리)
 *   REF_POOL4_AMOUNT    : 추천인 풀 4 총량(빈 값이면 0 처리)
 *
 * 산술/스케일:
 *   - Token.decimals()를 읽어 scale = 10^decimals 계산
 *   - BUY/REF 총합(totalTokens)을 scale 곱하여 on-chain 전송 단위(amountWei)로 환산
 *
 * 출력:
 *   - 배포 주소, vesting 주소, 전송 내역 및 최종 잔액 요약
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const hre = require('hardhat');
const { ethers } = hre;

// =============================================================================
// 유틸리티 함수
// =============================================================================

/**
 * @description 배포 산출물 JSON 파일을 로드합니다.
 * @param {string} p - 작업 디렉터리 기준 상대 경로 (예: './output/deployment-info.json')
 * @returns {any} 파싱된 JSON 객체
 * @throws {Error} 파일이 없거나 JSON 파싱 실패 시
 */
function loadJSON(p) {
    const abs = path.resolve(process.cwd(), p);
    if (!fs.existsSync(abs)) {
        throw new Error(`❌ deployment-info.json not found: ${abs}`);
    }
    const raw = fs.readFileSync(abs, 'utf8');
    return JSON.parse(raw);
}

/**
 * @description deployment-info.json에서 TokenVesting 주소를 찾아 유효성 검증 후 체크섬 주소로 반환합니다.
 * @param {{contracts?: {tokenVesting?: string}}} info - 배포 정보 객체
 * @returns {string} 체크섬 정규화된 vesting 주소
 * @throws {Error} 주소 누락, 형식 오류 시
 */
function findVestingAddress(info) {
    const addr = info?.contracts?.tokenVesting;
    if (typeof addr !== 'string' || addr.length === 0) {
        throw new Error('❌ tokenVesting not found in deployment-info.json (expected contracts.tokenVesting)');
    }
    if (!ethers.isAddress(addr)) {
        throw new Error(`❌ Invalid address format for tokenVesting: ${addr}`);
    }
    // 체크섬 정규화 (잘못되면 throw)
    return ethers.getAddress(addr);
}

/**
 * @description 환경변수에서 금액(토큰 "개수" 단위)을 읽어 BigInt로 반환합니다.
 *   - 허용: 숫자, 콤마, 언더스코어, 공백 (모두 제거 후 숫자만 남김)
 *   - 빈 값/미설정은 0n 처리
 * @param {string} name - 환경변수 키 이름
 * @returns {bigint} 토큰 개수(BigInt)
 * @throws {Error} 숫자 형식이 아닌 값인 경우
 */
function parseAmountEnv(name) {
    let v = process.env[name];
    if (!v) return 0n;
    v = String(v).trim();
    if (v === '') return 0n;
    // 허용: 숫자, 콤마, 언더스코어, 공백 (모두 제거 후 숫자만 남겨 BigInt 변환)
    const sanitized = v.replace(/[,\s_]/g, '');
    if (!/^\d+$/.test(sanitized)) {
        throw new Error(`❌ Invalid numeric env for ${name}: "${v}"`);
    }
    return BigInt(sanitized);
}

/**
 * @description BigInt/Number를 3자리 콤마 구분 문자열로 포맷합니다.
 * @param {bigint|number} n
 * @returns {string}
 */
function formatWithCommas(n) {
    return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitIfNeeded() {
    if (hre.network.name === 'localhost' || hre.network.name === 'hardhat' || hre.network.name === 'development') {
        console.log('⏳ 다음 tx를 위해 1초 대기...');
        await sleep(1000);
    }
}

// =============================================================================
// 메인
// =============================================================================

/**
 * @notice 메인 실행 함수
 * @description
 *   1) 지갑/프로바이더 준비
 *   2) Token 배포 및 파라미터(decimals/scale) 취득
 *   3) deployment-info.json에서 TokenVesting 주소 로드 및 연결
 *   4) vestingToken이 다르면 setVestingToken 호출(같으면 스킵)
 *   5) BUY/REF 풀 총합을 계산하여 on-chain 전송 단위로 환산
 *   6) 보유 잔액 확인 후 Vesting으로 전송, 결과 로그 출력
 */
async function main() {
    const ownerKey = process.env.OWNER_KEY;
    if (!ownerKey) throw new Error('❌ .env에 OWNER_KEY를 설정하세요.');
    const providerUrl = process.env.PROVIDER_URL || 'http://localhost:8545';
    const provider = new ethers.JsonRpcProvider(providerUrl);
    const owner = new ethers.Wallet(ownerKey, provider);
    console.log(`👤 Deployer: ${owner.address}`);

    // 1) Token 배포
    console.log('🚀 Deploying Token...');
    const Token = await ethers.getContractFactory('Token', owner);
    const token = await Token.deploy();
    await token.waitForDeployment();
    await waitIfNeeded();
    const tokenAddr = await token.getAddress();
    const tokenDec = await token.decimals();
    const scale = 10n ** BigInt(tokenDec);
    console.log(`✅ Token deployed at: ${tokenAddr} (decimals=${tokenDec})`);

    // 2) TokenVesting 주소 로드
     const deploymentPath = path.resolve(__dirname, './output/deployment-info.json');
    const info = loadJSON(deploymentPath);
    const vestingAddr = findVestingAddress(info);
    console.log(`📦 TokenVesting at: ${vestingAddr}`);

    const vesting = await ethers.getContractAt('TokenVesting', vestingAddr, owner);

    // 3) setVestingToken (이미 동일하면 스킵)
    const current = await vesting.vestingToken();
    if (current.toLowerCase() !== tokenAddr.toLowerCase()) {
        console.log('🛠️ Calling setVestingToken...');
        const tx = await vesting.setVestingToken(tokenAddr);
        await tx.wait();
        await waitIfNeeded();
        console.log('✅ setVestingToken done.');
    } else {
        console.log('ℹ️ vestingToken is already set to this Token. Skipping.');
    }

    // 3.5) deployment-info.json 업데이트 (contracts.vestingToken 저장)
    try {
        if (!info.contracts || typeof info.contracts !== 'object') info.contracts = {};
        info.contracts.vestingToken = tokenAddr;
        fs.writeFileSync(deploymentPath, JSON.stringify(info, null, 2));
        console.log(`💾 deployment-info.json updated: contracts.vestingToken = ${tokenAddr}`);
    } catch (e) {
        console.warn('⚠️ Failed to update deployment-info.json:', e?.message || e);
    }

    // 4) 환경변수에서 금액 합산 (토큰 "개수" 단위)
    const buy1 = parseAmountEnv('BUY_POOL1_AMOUNT');
    const buy2 = parseAmountEnv('BUY_POOL2_AMOUNT');
    const buy3 = parseAmountEnv('BUY_POOL3_AMOUNT');
    const buy4 = parseAmountEnv('BUY_POOL4_AMOUNT');
    const ref1 = parseAmountEnv('REF_POOL1_AMOUNT');
    const ref2 = parseAmountEnv('REF_POOL2_AMOUNT');
    const ref3 = parseAmountEnv('REF_POOL3_AMOUNT');
    const ref4 = parseAmountEnv('REF_POOL4_AMOUNT');

    const buySum = buy1 + buy2 + buy3 + buy4;
    const refSum = ref1 + ref2 + ref3 + ref4;
    const totalTokens = buySum + refSum; // "개수" 단위

    if (totalTokens === 0n) {
        console.log('⚠️ Total funding amount is 0. Nothing to transfer.');
        return;
    }

    // 5) 잔액 확인 및 전송 (decimals 스케일 반영)
    const amountWei = totalTokens * scale;

    const bal = await token.balanceOf(owner.address);
    if (bal < amountWei) {
        throw new Error(
            `❌ Insufficient token balance.\n` +
            `   Needed: ${formatWithCommas(totalTokens)} (×10^${tokenDec})\n` +
            `   Have:   ${formatWithCommas(bal / scale)} (×10^${tokenDec})`
        );
    }

    console.log(
        `💸 Transferring to TokenVesting:\n` +
        `   BUY sum: ${formatWithCommas(buySum)}\n` +
        `   REF sum: ${formatWithCommas(refSum)}\n` +
        `   TOTAL:   ${formatWithCommas(totalTokens)} tokens`
    );

    const tx2 = await token.transfer(vestingAddr, amountWei);
    const rcpt2 = await tx2.wait();
    await waitIfNeeded();
    console.log(`✅ Transfer tx: ${rcpt2.hash}`);

    // 6) 확인
    const vestingBal = await token.balanceOf(vestingAddr);
    console.log(`🏦 TokenVesting balance now: ${formatWithCommas(vestingBal / scale)} tokens`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
