// scripts/buyBox_insufficient_demo.js
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const hre = require('hardhat');
const { ethers } = hre;

function loadJSON(p) {
    if (!fs.existsSync(p)) throw new Error(`❌ 파일을 찾을 수 없습니다: ${p}`);
    return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function ensure8CharRef(s) {
    if (typeof s !== 'string' || s.length !== 8) {
        throw new Error('❌ refCodeStr는 정확히 8자여야 합니다 (A-Z/0-9).');
    }
    return s.toUpperCase();
}

function digRevertData(e) {
    // ethers v6 / hardhat에서 흔한 경로들을 샅샅이 탐색
    return (
        e?.info?.error?.data?.data ||   // Hardhat JSON-RPC nested
        e?.info?.error?.data ||         // sometimes directly here
        e?.data ||                      // ethers error.data
        e?.error?.data ||               // fallback
        null
    );
}

function hexlify(v) {
    try { return ethers.hexlify(v); } catch { return null; }
}

function decodeWith(iface, data) {
    try {
        const err = iface.parseError(data);
        return { ok: true, name: err?.name, args: err?.args };
    } catch {
        return { ok: false };
    }
}

async function main() {
    console.log('🚀 buyBox (잔액부족 → revert 데이터 덤프) 시작');

    const providerUrl = process.env.PROVIDER_URL || 'http://127.0.0.1:8545';
    const pk = process.env.PRIVATE_KEY;
    if (!pk) throw new Error('❌ .env에 PRIVATE_KEY를 설정하세요.');

    const depPath  = path.resolve(__dirname, './output/deployment-info.json');
    const dataPath = path.resolve(__dirname, './data/buyBox.json');

    const dep = loadJSON(depPath);
    const cfg = loadJSON(dataPath);

    const tokenVestingAddr = dep?.contracts?.tokenVesting;
    const usdtAddr = dep?.contracts?.stableCoin;
    const recipientAddr = dep?.contracts?.recipient;

    if (!ethers.isAddress(tokenVestingAddr) || !ethers.isAddress(usdtAddr)) {
        throw new Error('❌ deployment-info.json에서 주소를 읽지 못했습니다 (tokenVesting / stableCoin).');
    }

    const amount = BigInt(cfg?.amount ?? 0);
    if (!amount || amount <= 0n) throw new Error('❌ data/buyBox.json 의 amount가 유효하지 않습니다.');
    const refCodeStr = ensure8CharRef(cfg?.ref ?? '');

    console.log('🌐 네트워크:', hre.network.name);
    console.log('📄 TokenVesting:', tokenVestingAddr);
    console.log('📄 USDT:', usdtAddr);
    console.log('🧾 amount(박스 수량):', amount.toString());
    console.log('🏷️ refCodeStr:', JSON.stringify(refCodeStr));

    const provider   = new ethers.JsonRpcProvider(providerUrl);
    const baseWallet = new ethers.Wallet(pk, provider);
    const wallet     = new ethers.NonceManager(baseWallet);
    const buyerAddr  = await wallet.getAddress();

    const vesting = await ethers.getContractAt('TokenVesting', tokenVestingAddr, wallet);
    const usdt    = await ethers.getContractAt('StableCoin',    usdtAddr,        wallet);

    const decimals = await usdt.decimals();
    const symbol   = (await usdt.symbol?.().catch(() => 'TOKEN')) || 'TOKEN';
    const tokenName= (await usdt.name?.().catch(() => 'Token'))  || 'Token';

    // 1) 견적
    const required = await vesting.estimatedTotalAmount(amount, refCodeStr);
    if (required === 0n) throw new Error('❌ 유효하지 않은 레퍼럴 코드입니다.');
    console.log(`\n🧮 필요 ${symbol}: ${ethers.formatUnits(required, decimals)} ${symbol}`);

    // 2) 잔액 확인 (충전/approve 안 함)
    const buyerBal = await usdt.balanceOf(buyerAddr);
    console.log('\n💰 buyer 잔액:', ethers.formatUnits(buyerBal, decimals), symbol);

    if (buyerBal >= required) {
        console.log('\n⚠️ 이 데모는 잔액부족 revert 재현용입니다. buyer 잔액이 충분합니다.');
        process.exit(1);
    }

    // 3) PERMIT 생성
    const chain    = await provider.getNetwork();
    const nonce    = await usdt.nonces(buyerAddr);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 30); // +30m

    const domain = {
        name: tokenName,
        version: '1',
        chainId: Number(chain.chainId),
        verifyingContract: usdtAddr,
    };
    const types = {
        Permit: [
            { name: 'owner',    type: 'address' },
            { name: 'spender',  type: 'address' },
            { name: 'value',    type: 'uint256' },
            { name: 'nonce',    type: 'uint256' },
            { name: 'deadline', type: 'uint256' },
        ],
    };
    const message = { owner: buyerAddr, spender: tokenVestingAddr, value: required, nonce, deadline };
    console.log('\n📝 permit 서명 생성 중...');
    const signature = await wallet.signTypedData(domain, types, message);
    const sig = ethers.Signature.from(signature);
    console.log('✅ permit 서명 완료');

    const p = { value: required, deadline, v: sig.v, r: sig.r, s: sig.s };

    // 4) buyBox 호출 → 실패 유도, revert 데이터 출력
    console.log('\n🛒 buyBox 호출 (잔액 부족으로 revert 기대)...');

    // 커스텀 에러 디코딩 시도용 인터페이스들 (OZ v5 ERC20/Permit에서 흔함)
    const erc20Errs = new ethers.Interface([
        "error ERC20InsufficientBalance(address account, uint256 balance, uint256 needed)",
        "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
        "error ERC20InvalidSender(address sender)",
        "error ERC20InvalidReceiver(address receiver)",
        "error ERC20InvalidApprover(address approver)",
        "error ERC20InvalidSpender(address spender)",
    ]);
    const permitErrs = new ethers.Interface([
        "error ERC2612ExpiredSignature(uint256 deadline)",
        "error ERC2612InvalidSigner(address signer, address owner)",
        // 일부 구현체에서는 다른 이름을 쓸 수 있으므로 실패하면 무시
    ]);

    try {
        const tx = await vesting.buyBox(amount, refCodeStr, p);
        const rc = await tx.wait();
        console.log('⚠️ 예상과 다르게 성공했습니다. txHash:', rc.hash);
    } catch (e) {
        console.log('✅ 예상대로 revert 발생');

        // 4-1) 원시 revert 데이터(hex) 추출
        const raw = digRevertData(e);
        const rawHex = typeof raw === 'string' ? raw : hexlify(raw);
        console.log('   • raw revert data:', rawHex || '(없음)');

        // 4-2) 커스텀 에러 디코딩 시도 (ERC20 → Permit 순서)
        if (rawHex && rawHex !== '0x') {
            let decoded = decodeWith(erc20Errs, rawHex);
            if (decoded.ok) {
                console.log(`   • decoded (ERC20): ${decoded.name}`);
                console.log('     args:', decoded.args);
                return;
            }
            decoded = decodeWith(permitErrs, rawHex);
            if (decoded.ok) {
                console.log(`   • decoded (ERC2612): ${decoded.name}`);
                console.log('     args:', decoded.args);
                return;
            }
            console.log('   • 알 수 없는 커스텀 에러(ABI 미일치). 원시 hex만 출력했습니다.');
        } else {
            console.log('   • revert 데이터가 비어있습니다 (panic/invalid 등일 수 있음).');
        }
    }
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error('❌ 실행 실패:', e?.shortMessage || e?.message || e);
        process.exit(1);
    });
