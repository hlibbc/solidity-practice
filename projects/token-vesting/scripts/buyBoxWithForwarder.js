// scripts/buyBoxWithForwarder.js
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const hre = require('hardhat');
const { ethers } = hre;
const Shared = require('./_shared'); // 선택 유틸

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

async function main() {
    console.log('🚀 buyBox (ERC2771 위임대납) 실행');

    // ── env / 입력
    const providerUrl = process.env.PROVIDER_URL || 'http://127.0.0.1:8545';
    const buyerPK     = process.env.PRIVATE_KEY;
    const relayerPK   = process.env.OWNER_KEY;
    if (!buyerPK)  throw new Error('❌ .env의 PRIVATE_KEY가 필요합니다 (구매자)');
    if (!relayerPK) throw new Error('❌ .env의 OWNER_KEY가 필요합니다 (리레이어)');

    const depPath  = path.resolve(__dirname, './output/deployment-info.json');
    const cfgPath  = path.resolve(__dirname, './data/buyBox.json');

    const dep = loadJSON(depPath);
    const cfg = loadJSON(cfgPath);

    const forwarderAddr      = dep?.forwarder;
    const tokenVestingAddr   = dep?.contracts?.tokenVesting;
    const usdtAddr           = dep?.contracts?.stableCoin;
    const recipientAddr      = dep?.contracts?.recipient;

    if (!ethers.isAddress(forwarderAddr) || !ethers.isAddress(tokenVestingAddr) || !ethers.isAddress(usdtAddr)) {
        throw new Error('❌ deployment-info.json에서 forwarder/tokenVesting/stableCoin 주소를 읽지 못했습니다.');
    }

    const amount     = BigInt(cfg?.amount ?? 0);
    const refCodeStr = ensure8CharRef(cfg?.ref ?? '');
    if (!amount || amount <= 0n) throw new Error('❌ data/buyBox.json 의 amount가 유효하지 않습니다.');

    // ── provider & wallets
    const provider  = new ethers.JsonRpcProvider(providerUrl);
    const buyerBase = new ethers.Wallet(buyerPK, provider);   // 메타Tx 실제 서명자(구매자)
    const relayer   = new ethers.NonceManager(new ethers.Wallet(relayerPK, provider)); // 가스 지불자

    const buyerAddr   = await buyerBase.getAddress();
    const relayerAddr = await relayer.getAddress();

    // ── attach contracts
    const vesting   = await ethers.getContractAt('TokenVesting',        tokenVestingAddr, relayer);
    const usdt      = await ethers.getContractAt('StableCoin',          usdtAddr,        relayer);
    const forwarder = await ethers.getContractAt('WhitelistForwarder',  forwarderAddr,   relayer);

    const chain     = await provider.getNetwork();
    const decimals  = await usdt.decimals();
    const symbol    = (await usdt.symbol?.().catch(() => 'TOKEN')) || 'TOKEN';
    const tokenName = (await usdt.name?.().catch(() => 'Token'))  || 'Token';

    console.log('🌐 네트워크:', hre.network.name);
    console.log('📄 Forwarder    :', forwarderAddr);
    console.log('📄 TokenVesting :', tokenVestingAddr);
    console.log('📄 USDT         :', usdtAddr);
    console.log('👤 buyer        :', buyerAddr);
    console.log('⛽ relayer      :', relayerAddr);
    console.log('🧾 amount       :', amount.toString());
    console.log('🏷️ refCodeStr   :', JSON.stringify(refCodeStr));

    // ── 사전 ETH 잔액
    const ethOf = async (a) => ethers.formatEther(await provider.getBalance(a));
    const buyerEthBefore   = await ethOf(buyerAddr);
    const relayerEthBefore = await ethOf(relayerAddr);

    console.log('\n⛽ ETH 잔액 (호출 전)');
    console.log(`    • buyer   : ${buyerEthBefore} ETH`);
    console.log(`    • relayer : ${relayerEthBefore} ETH`);

    // ── 1) 총 금액 견적 (레퍼럴 검증 포함)
    const required = await vesting.estimatedTotalAmount(amount, refCodeStr);
    if (required === 0n) throw new Error('❌ 유효하지 않은 레퍼럴 코드입니다. (estimatedTotalAmount가 0 반환)');
    console.log(`\n🧮 필요 ${symbol}: ${ethers.formatUnits(required, decimals)} ${symbol}`);

    // ── 2) EIP-2612 PERMIT 서명 (owner = buyer, spender = TokenVesting)
    const permitNonce = await usdt.nonces(buyerAddr);
    const permitDeadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 30); // +30분
    const permitDomain = {
        name: tokenName,
        version: '1',
        chainId: Number(chain.chainId),
        verifyingContract: usdtAddr,
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
        owner:    buyerAddr,
        spender:  tokenVestingAddr,
        value:    required,
        nonce:    permitNonce,
        deadline: permitDeadline,
    };
    console.log('\n📝 permit 서명 생성 중...');
    const permitSig = await buyerBase.signTypedData(permitDomain, permitTypes, permitMsg);
    const permitParsed = ethers.Signature.from(permitSig);
    console.log('✅ permit 서명 완료');

    // TokenVesting.PermitData
    const p = {
        value:    required,
        deadline: permitDeadline,
        v:        permitParsed.v,
        r:        permitParsed.r,
        s:        permitParsed.s,
    };

    // ── 3) buyBox calldata 생성
    const vestingIface = vesting.interface;
    const callData = vestingIface.encodeFunctionData('buyBox', [amount, refCodeStr, p]);

    // ── 2.5) 부족하면 OWNER로부터 자동 충전 (선택)
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

    // ── 4) ERC2771 ForwardRequest EIP-712 서명 (signer = buyer)
    const fwdNonce    = await forwarder.nonces(buyerAddr);
    const fwdGas      = BigInt(process.env.FWD_REQ_GAS || 1_100_000); // 내부 call에 쓸 gas
    const fwdDeadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 30);

    const fwdDomain = {
        name: 'WhitelistForwarder',
        version: '1',
        chainId: Number(chain.chainId),
        verifyingContract: forwarderAddr,
    };
    const fwdTypes = {
        ForwardRequest: [
            { name: 'from',    type: 'address' },
            { name: 'to',      type: 'address' },
            { name: 'value',   type: 'uint256' },
            { name: 'gas',     type: 'uint256' },
            { name: 'nonce',   type: 'uint256' },
            { name: 'data',    type: 'bytes'   },
            { name: 'deadline',type: 'uint256' },
        ],
    };
    const fwdMsg = {
        from:     buyerAddr,
        to:       tokenVestingAddr,
        value:    0n,
        gas:      fwdGas,
        nonce:    fwdNonce,
        data:     callData,
        deadline: fwdDeadline,
    };
    console.log('\n🖋️ ForwardRequest 서명 생성 중...');
    const fwdSig = await buyerBase.signTypedData(fwdDomain, fwdTypes, fwdMsg);
    console.log('✅ ForwardRequest 서명 완료');

    // ── 5) forwarder.execute(request) 호출 (sender = relayer, 가스 지불)
    // 주의: ForwardRequestData 구조체는 구현(ABI)에 따라 signature 필드가 포함됩니다.
    // OZ v5의 ERC2771Forwarder는 signature를 별도 인자로 받지 않고 struct에 포함하는 형태입니다.
    const request = {
        from:     fwdMsg.from,
        to:       fwdMsg.to,
        value:    fwdMsg.value,
        gas:      fwdMsg.gas,
        nonce:    fwdMsg.nonce,
        deadline: fwdMsg.deadline,
        data:     fwdMsg.data,
        signature: fwdSig,
    };

    console.log('\n🚚 forwarder.execute 호출 (리레이어가 가스 지불)...');
    // EIP-150 여유를 위해 tx gasLimit는 request.gas보다 약간 크게
    const tx = await forwarder.execute(request, {
        gasLimit: Number(fwdGas) + 150_000,
        value: 0,
    });
    const rc = await tx.wait();
    console.log('✅ 실행 완료. txHash:', rc.hash);

    // ── 사후 ETH 잔액
    const buyerEthAfter   = await ethOf(buyerAddr);
    const relayerEthAfter = await ethOf(relayerAddr);

    console.log('\n⛽ ETH 잔액 (호출 후)');
    console.log(`    • buyer   : ${buyerEthAfter} ETH`);
    console.log(`    • relayer : ${relayerEthAfter} ETH`);

    console.log('\n🎉 위임대납 buyBox 완료!');
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        // 원시 revert data도 가능하면 표시
        const raw = e?.info?.error?.data?.data || e?.info?.error?.data || e?.data || e?.error?.data;
        console.error('❌ 실행 실패:', e?.shortMessage || e?.message || e);
        if (raw) console.error('   • raw revert data:', typeof raw === 'string' ? raw : (() => { try { return ethers.hexlify(raw);} catch { return '(hex 변환 실패)'; } })());
        process.exit(1);
    });
