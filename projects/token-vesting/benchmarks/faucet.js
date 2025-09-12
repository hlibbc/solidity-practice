/* eslint-disable no-console */
/**
 * @fileoverview
 *  간단 파우셋 스크립트
 * @description
 *  - ./faucet.json을 읽어 { to, amount } 추출
 *  - ./deployment-info.json에서 stableCoin 주소 추출
 *  - .env 의 OWNER_KEY로 to 에게 amount(whole) × 10^decimals 만큼 전송
 *  - 전송 전/후 OWNER와 to의 잔액을 ethers.formatUnits(decimals)로 출력
 */

require('dotenv').config({ path: require('path').resolve(__dirname, './.env') });

const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

/**
 * @notice JSON 로더 (상대경로 기준)
 * @param {string} rel 상대경로
 * @returns {any} 파싱된 JSON
 */
function loadJSON(rel) {
    const p = path.resolve(__dirname, rel);
    if (!fs.existsSync(p)) throw new Error(`❌ 파일을 찾을 수 없습니다: ${p}`);
    return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/**
 * @notice 메인 엔트리
 */
async function main() {
    console.log('🚰 Faucet 시작');

    // ---- env ----
    const { PROVIDER_URL, OWNER_KEY } = process.env;
    if (!OWNER_KEY) throw new Error('❌ .env의 OWNER_KEY가 필요합니다.');

    // ---- provider & signer ----
    const provider = new ethers.JsonRpcProvider(PROVIDER_URL || 'http://127.0.0.1:8545');
    const owner = new ethers.Wallet(OWNER_KEY, provider);

    // ---- inputs ----
    const faucet = loadJSON('./faucet.json'); // { to, amount }
    const dep = loadJSON('./deployment-info.json');

    const to = faucet?.to;
    const amountWhole = BigInt(faucet?.amount ?? 0);
    const stableAddr = dep?.contracts?.stableCoin;

    if (!ethers.isAddress(to)) throw new Error('❌ faucet.json 의 to 주소가 유효하지 않습니다.');
    if (!ethers.isAddress(stableAddr)) throw new Error('❌ deployment-info.json 의 stableCoin 주소가 유효하지 않습니다.');
    if (amountWhole <= 0n) throw new Error('❌ faucet.json 의 amount 값이 유효하지 않습니다 (> 0 이어야 함).');

    // ---- load StableCoin ----
    const erc20Abi = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../artifacts/contracts/Usdt.sol/StableCoin.json'), 'utf8')).abi;
    const token = new ethers.Contract(stableAddr, erc20Abi, owner);

    const decimals = Number(await token.decimals());
    const symbol = (await token.symbol?.().catch(() => 'TOKEN')) || 'TOKEN';

    const unit = 10n ** BigInt(decimals);
    const amount = amountWhole * unit; // whole × 10^decimals

    // ---- balances (before) ----
    const bal = async (addr) => await token.balanceOf(addr);
    const [ownerBefore, toBefore] = await Promise.all([bal(owner.address), bal(to)]);
    console.log('💰 잔액 (전)');
    console.log(`  • owner(${owner.address}): ${ethers.formatUnits(ownerBefore, decimals)} ${symbol}`);
    console.log(`  • to   (${to})        : ${ethers.formatUnits(toBefore, decimals)} ${symbol}`);

    // ---- transfer ----
    console.log(`\n🚚 전송: ${ethers.formatUnits(amount, decimals)} ${symbol} → ${to}`);
    const tx = await token.transfer(to, amount);
    console.log(`⏳ Tx sent: ${tx.hash}`);
    const rc = await tx.wait();
    console.log(`✅ 완료. status=${rc.status} block=${rc.blockNumber}`);

    // ---- balances (after) ----
    const [ownerAfter, toAfter] = await Promise.all([bal(owner.address), bal(to)]);
    console.log('\n💰 잔액 (후)');
    console.log(`  • owner(${owner.address}): ${ethers.formatUnits(ownerAfter, decimals)} ${symbol}`);
    console.log(`  • to   (${to})        : ${ethers.formatUnits(toAfter, decimals)} ${symbol}`);

    console.log('\n🎉 Faucet 완료');
}

main().catch((e) => {
    console.error('❌ Faucet 실패:', e?.shortMessage || e?.message || e);
    process.exit(1);
});


