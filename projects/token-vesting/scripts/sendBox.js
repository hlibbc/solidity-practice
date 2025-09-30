// scripts/sendBox.js
//
// 목적
// - TokenVesting의 sendBox(from, to, amount)를 실행하여 박스 소유권을 이전합니다.
// - 호출 주체는 .env의 OWNER_KEY(컨트랙트 owner) 입니다.
// - 입력은 ./input/sendBox.json 의 { from, to, amount } 를 사용합니다.
//
// 사용법
//   pnpm hardhat run scripts/sendBox.js --network <network>
//   (또는) npx hardhat run scripts/sendBox.js --network <network>
//
// 사전조건
// - ./output/deployment-info.json 에 tokenVesting 주소가 기록되어 있어야 합니다.
// - .env 에 OWNER_KEY, (선택) PROVIDER_URL 이 설정되어 있어야 합니다.
//
// 주의사항
// - sendBox 는 onlyOwner 전용 함수입니다. OWNER_KEY 가 컨트랙트 owner 와 일치해야 합니다.
// - amount 는 박스 수량(정수)이며, 당일부터 효력이 발생합니다.

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const hre = require('hardhat');
const { ethers } = hre;

function loadJSON(p) {
    if (!fs.existsSync(p)) {
        throw new Error(`❌ 파일을 찾을 수 없습니다: ${p}`);
    }
    return JSON.parse(fs.readFileSync(p, 'utf8'));
}

async function waitIfLocal() {
    if (['localhost', 'hardhat', 'development'].includes(hre.network.name)) {
        await new Promise((r) => setTimeout(r, 300));
    }
}

function ensureAddress(addr, name) {
    if (!addr || !ethers.isAddress(addr)) {
        throw new Error(`❌ 잘못된 주소(${name}): ${addr}`);
    }
    return addr;
}

async function main() {
    console.log('🚀 sendBox 실행 스크립트 시작');

    // ── 환경/입력
    const providerUrl = process.env.PROVIDER_URL || 'http://127.0.0.1:8545';
    const ownerKey = process.env.OWNER_KEY;
    if (!ownerKey) throw new Error('❌ .env에 OWNER_KEY를 설정하세요.');

    const deploymentPath = path.resolve(__dirname, './output/deployment-info.json');
    const sendBoxPath = path.resolve(__dirname, './input/sendBox.json');

    const dep = loadJSON(deploymentPath);
    const cfg = loadJSON(sendBoxPath);

    const tokenVestingAddr = ensureAddress(dep?.contracts?.tokenVesting, 'tokenVesting');

    const from = ensureAddress(cfg?.from, 'from');
    const to = ensureAddress(cfg?.to, 'to');
    const amount = BigInt(cfg?.amount ?? 0);
    if (!amount || amount <= 0n) throw new Error('❌ input/sendBox.json 의 amount가 유효하지 않습니다 (>0 정수 필요).');

    console.log('🌐 네트워크:', hre.network.name);
    console.log('📄 TokenVesting:', tokenVestingAddr);
    console.log('👤 호출자(지갑): OWNER_KEY 사용');
    console.log('↪️ from:', from);
    console.log('↪️ to  :', to);
    console.log('📦 amount(박스 수량):', amount.toString());

    // ── provider / wallet
    const provider = new ethers.JsonRpcProvider(providerUrl);
    const baseWallet = new ethers.Wallet(ownerKey, provider);
    const wallet = new ethers.NonceManager(baseWallet);
    const ownerAddr = await wallet.getAddress();

    // ── contracts
    const vesting = await ethers.getContractAt('TokenVesting', tokenVestingAddr, wallet);

    // ── 사전 검사: 컨트랙트 owner 확인
    const onchainOwner = await vesting.owner();
    if (onchainOwner.toLowerCase() !== ownerAddr.toLowerCase()) {
        throw new Error(`❌ OWNER_KEY(${ownerAddr})가 컨트랙트 owner(${onchainOwner})와 다릅니다.`);
    }

    // ── 실행 전 간단한 상태 정보
    const totalBoxesBefore = await vesting.getTotalBoxPurchased();
    console.log('\n📦 현재까지 구매된 박스 총량:', totalBoxesBefore.toString());

    // ── sendBox 실행
    console.log('\n📤 sendBox 실행 중...');
    const tx = await vesting.sendBox(from, to, amount);
    const rcpt = await tx.wait();
    console.log('✅ sendBox 성공. txHash:', rcpt.hash);
    await waitIfLocal();

    // ── 마무리 출력(선택 정보)
    const totalBoxesAfter = await vesting.getTotalBoxPurchased();
    console.log('\n📦 (참고) 구매된 박스 총량(변경 없음이 정상):', totalBoxesAfter.toString());
    console.log('\n🎉 스크립트 완료!');
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error('❌ 실행 실패:', e?.shortMessage || e?.message || e);
        process.exit(1);
    });


