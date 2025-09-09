// scripts/buyBox.js
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const hre = require('hardhat');
const { ethers } = hre;
const Shared = require('./_shared'); // 선택 유틸

function loadJSON(p) {
    if (!fs.existsSync(p)) {
        throw new Error(`❌ 파일을 찾을 수 없습니다: ${p}`);
    }
    return JSON.parse(fs.readFileSync(p, 'utf8'));
}

async function waitIfLocal() {
    if (['localhost', 'hardhat', 'development'].includes(hre.network.name)) {
        await new Promise((r) => setTimeout(r, 500));
    }
}

function ensure8CharRef(s) {
    if (typeof s !== 'string' || s.length !== 8) {
        throw new Error('❌ refCodeStr는 정확히 8자여야 합니다 (A-Z/0-9).');
    }
    // 대문자 변환만 미리 해두고, 나머지 검증은 컨트랙트가 책임
    return s.toUpperCase();
}

async function main() {
    console.log('🚀 buyBox 실행 스크립트 시작');

    // ── 환경/입력
    const providerUrl = process.env.PROVIDER_URL || 'http://127.0.0.1:8545';
    const pk = process.env.PRIVATE_KEY;
    if (!pk) throw new Error('❌ .env에 PRIVATE_KEY를 설정하세요.');

    const deploymentPath = path.resolve(__dirname, './output/deployment-info.json');
    const buyBoxPath = path.resolve(__dirname, './data/buyBox.json');

    const dep = loadJSON(deploymentPath);
    const cfg = loadJSON(buyBoxPath);

    const tokenVestingAddr = dep?.contracts?.tokenVesting;
    const usdtAddr = dep?.contracts?.stableCoin;
    const recipientAddr = dep?.contracts?.recipient;

    if (!ethers.isAddress(tokenVestingAddr) || !ethers.isAddress(usdtAddr)) {
        throw new Error('❌ deployment-info.json에서 주소를 읽지 못했습니다 (tokenVesting / stableCoin).');
    }
    if (!recipientAddr || !ethers.isAddress(recipientAddr)) {
        console.warn('⚠️ recipient 주소가 비어있거나 유효하지 않습니다. (buyBox 시 revert 가능)');
    }

    const amount = BigInt(cfg?.amount ?? 0);
    if (!amount || amount <= 0n) throw new Error('❌ data/buyBox.json 의 amount가 유효하지 않습니다.');
    const refCodeStr = ensure8CharRef(cfg?.ref ?? '');

    console.log('🌐 네트워크:', hre.network.name);
    console.log('📄 TokenVesting:', tokenVestingAddr);
    console.log('📄 USDT:', usdtAddr);
    console.log('👤 구매자(지갑): PRIVATE_KEY 사용');
    console.log('🧾 amount(박스 수량):', amount.toString());
    console.log('🏷️ refCodeStr:', JSON.stringify(refCodeStr));

    // ── provider / wallet
    const provider = new ethers.JsonRpcProvider(providerUrl);
    const baseWallet = new ethers.Wallet(pk, provider);
    const wallet = new ethers.NonceManager(baseWallet);
    const buyerAddr = await wallet.getAddress();

    // ── contracts
    const vesting = await ethers.getContractAt('TokenVesting', tokenVestingAddr, wallet);
    const usdt = await ethers.getContractAt('StableCoin', usdtAddr, wallet); // artifact 이름 확인

    const decimals = await usdt.decimals();
    const symbol = (await usdt.symbol?.().catch(() => 'TOKEN')) || 'TOKEN';
    const tokenName = (await usdt.name?.().catch(() => 'Token')) || 'Token';

    // ── 1) 견적: estimatedTotalAmount(uint256,string)
    let required;
    try {
        required = await vesting.estimatedTotalAmount(amount, refCodeStr);
    } catch (e) {
        throw new Error(`❌ estimatedTotalAmount(amount,string) 호출 실패: ${e?.shortMessage || e?.message || e}`);
    }
    if (required === 0n) {
        throw new Error('❌ 유효하지 않은 레퍼럴 코드입니다. (estimatedTotalAmount가 0 반환)');
    }
    console.log(`\n🧮 필요 ${symbol} 금액:`, ethers.formatUnits(required, decimals), symbol);

    // ── 2) 잔액/사전 상태
    let buyerBal = await usdt.balanceOf(buyerAddr);
    const vestingBal = await usdt.balanceOf(tokenVestingAddr);
    const recipBal = recipientAddr ? await usdt.balanceOf(recipientAddr) : 0n;
    const totalBoxesBefore = await vesting.getTotalBoxPurchased();
    const totalRefsBefore = await vesting.getTotalReferralUnits();

    console.log('\n💰 현재 잔액');
    console.log(`    • buyer(${buyerAddr})        :`, ethers.formatUnits(buyerBal, decimals), symbol);
    console.log(`    • vesting(${tokenVestingAddr}):`, ethers.formatUnits(vestingBal, decimals), symbol);
    if (recipientAddr) {
        console.log(`    • recipient(${recipientAddr}) :`, ethers.formatUnits(recipBal, decimals), symbol);
    }
    console.log('📦 현재까지 구매된 박스 총량:', totalBoxesBefore.toString());
    console.log('📦 현재까지 레퍼럴된 박스 총량:', totalRefsBefore.toString());

    // ── 2.5) 부족하면 OWNER로부터 자동 충전 (선택)
    const ownerKey = process.env.OWNER_KEY;
    if (buyerBal < required) {
        if (!ownerKey) {
            console.warn('⚠️ OWNER_KEY 가 .env에 없어 자동 충전을 건너뜁니다.');
        } else {
            const ownerBase = new ethers.Wallet(ownerKey, provider);
            const owner = new ethers.NonceManager(ownerBase);
            const ownerAddr = await owner.getAddress();

            const need = required - buyerBal; // 부족분만 충전
            const ownerBal = await usdt.balanceOf(ownerAddr);

            console.log(`\n🤝 USDT 자동 충전: owner(${ownerAddr}) → buyer(${buyerAddr})`);
            console.log(`    • 필요한 금액 : ${ethers.formatUnits(need, decimals)} ${symbol}`);
            console.log(`    • owner 잔액 : ${ethers.formatUnits(ownerBal, decimals)} ${symbol}`);

            if (ownerBal < need) {
                throw new Error(`❌ OWNER의 USDT 부족: 필요=${ethers.formatUnits(need, decimals)} ${symbol}, 보유=${ethers.formatUnits(ownerBal, decimals)} ${symbol}`);
            }

            const txFund = await usdt.connect(owner).transfer(buyerAddr, need);
            if (Shared?.withGasLog) {
                await Shared.withGasLog('[fund] owner→buyer USDT', Promise.resolve(txFund), {}, 'setup');
            }
            const rcFund = await txFund.wait();
            console.log('✅ 충전 완료. txHash:', rcFund.hash);
            await waitIfLocal();

            // 충전 후 buyer 잔액 재조회
            buyerBal = await usdt.balanceOf(buyerAddr);
            console.log(`    • 충전 후 buyer 잔액: ${ethers.formatUnits(buyerBal, decimals)} ${symbol}`);
        }
    }

    // 최종 잔액 확인
    if (buyerBal < required) {
        throw new Error(`❌ 잔액 부족: 필요=${ethers.formatUnits(required, decimals)} ${symbol}, 보유=${ethers.formatUnits(buyerBal, decimals)} ${symbol}`);
    }

    // ── 3) PERMIT 서명 생성 (EIP-2612)
    // OZ ERC20Permit 표준: Permit(owner, spender, value, nonce, deadline)
    const chain = await provider.getNetwork();
    const nonce = await usdt.nonces(buyerAddr);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 30); // 지금부터 30분
    const domain = {
        name: tokenName,
        version: '1',
        chainId: Number(chain.chainId),
        verifyingContract: usdtAddr,
    };
    const types = {
        Permit: [
            { name: 'owner', type: 'address' },
            { name: 'spender', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'nonce', type: 'uint256' },
            { name: 'deadline', type: 'uint256' },
        ],
    };
    const message = {
        owner: buyerAddr,
        spender: tokenVestingAddr,
        value: required,
        nonce,
        deadline,
    };

    console.log('\n📝 permit 서명 생성 중...');
    const signature = await wallet.signTypedData(domain, types, message);
    const sig = ethers.Signature.from(signature);
    console.log('✅ permit 서명 완료');

    // ── 4) buyBox 전 잔액 재출력(선택)
    const preBuyer = await usdt.balanceOf(buyerAddr);
    const preVesting = await usdt.balanceOf(tokenVestingAddr);
    const preRecip = recipientAddr ? await usdt.balanceOf(recipientAddr) : 0n;

    console.log('\n💰 buyBox 전 잔액');
    console.log(`    • buyer   :`, ethers.formatUnits(preBuyer, decimals), symbol);
    console.log(`    • vesting :`, ethers.formatUnits(preVesting, decimals), symbol);
    if (recipientAddr) {
        console.log(`    • recipient:`, ethers.formatUnits(preRecip, decimals), symbol);
    }

    // ── 5) buyBox 호출 (permit 사용 경로: deadline!=0)
    // struct PermitData { uint256 value; uint256 deadline; uint8 v; bytes32 r; bytes32 s; }
    const p = {
        value: required,
        deadline: deadline,
        v: sig.v,
        r: sig.r,
        s: sig.s,
    };

    console.log('\n🛒 buyBox 실행 중...(permit)');
    const txBuy = await vesting.buyBox(amount, refCodeStr, p);
    if (Shared?.withGasLog) {
        await Shared.withGasLog('[buy] vesting.buyBox (permit)', Promise.resolve(txBuy), {}, 'setup');
    }
    const rcptBuy = await txBuy.wait();
    console.log('✅ buyBox 성공. txHash:', rcptBuy.hash);
    await waitIfLocal();

    // ── 6) buyBox 이후 잔액
    const postBuyer = await usdt.balanceOf(buyerAddr);
    const postVesting = await usdt.balanceOf(tokenVestingAddr);
    const postRecip = recipientAddr ? await usdt.balanceOf(recipientAddr) : 0n;

    console.log('\n💰 buyBox 이후 잔액');
    console.log(`    • buyer   :`, ethers.formatUnits(postBuyer, decimals), symbol);
    console.log(`    • vesting :`, ethers.formatUnits(postVesting, decimals), symbol);
    if (recipientAddr) {
        console.log(`    • recipient:`, ethers.formatUnits(postRecip, decimals), symbol);
    }

    console.log('\n🎉 스크립트 완료!');
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error('❌ 실행 실패:', e?.shortMessage || e?.message || e);
        process.exit(1);
    });
