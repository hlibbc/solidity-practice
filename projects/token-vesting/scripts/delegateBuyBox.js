// scripts/buyBoxWithForwarder.js
/* eslint-disable no-console */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const hre = require('hardhat');
const { ethers } = hre;
const Shared = require('./_shared'); // selectorForBuyBox 사용(선택)

function loadJSON(rel) {
    const p = path.resolve(__dirname, rel);
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

    // ---- env ----
    const { PRIVATE_KEY, OWNER_KEY } = process.env;
    if (!PRIVATE_KEY) throw new Error('❌ .env의 PRIVATE_KEY(구매자 서명자)가 필요합니다.');
    if (!OWNER_KEY)   throw new Error('❌ .env의 OWNER_KEY(릴레이어)가 필요합니다.');

    // ---- load files ----
    const dep = loadJSON('./output/deployment-info.json');
    const cfg = loadJSON('./data/buyBox.json'); // { amount, ref, (optional) deadline, gas_call, gas_execute }

    const forwarderAddr    = dep?.forwarder;
    const tokenVestingAddr = dep?.contracts?.tokenVesting;
    const usdtAddr         = dep?.contracts?.stableCoin;
    const recipientAddr    = dep?.contracts?.recipient;

    if (!ethers.isAddress(forwarderAddr) || !ethers.isAddress(tokenVestingAddr) || !ethers.isAddress(usdtAddr)) {
        throw new Error('❌ deployment-info.json에서 forwarder/tokenVesting/stableCoin 주소를 읽지 못했습니다.');
    }

    const amount     = BigInt(cfg?.amount ?? 0);
    const refCodeStr = ensure8CharRef(cfg?.ref ?? '');
    if (!amount || amount <= 0n) throw new Error('❌ data/buyBox.json 의 amount가 유효하지 않습니다.');

    // meta (delegateTestFunc 포맷과 동일 키 사용; 없으면 기본값)
    const gasCall    = BigInt(cfg?.gas_call    ?? 1_500_000);
    const gasExecute = BigInt(cfg?.gas_execute ?? 3_000_000);
    const deadlineIn = Number(cfg?.deadline    ?? 3600); // seconds → uint48

    // ---- provider & wallets ----
    const signer  = new ethers.Wallet(PRIVATE_KEY, hre.ethers.provider); // 구매자(_msgSender)
    const relayer = new ethers.Wallet(OWNER_KEY,   hre.ethers.provider); // 가스 지불자

    const chain   = await hre.ethers.provider.getNetwork();
    const chainId = Number(chain.chainId);

    console.log(`🔗 Network: chainId=${chainId} (${hre.network.name})`);
    console.log(`🧭 Forwarder: ${forwarderAddr}`);
    console.log(`📦 TokenVesting: ${tokenVestingAddr}`);
    console.log(`💵 StableCoin: ${usdtAddr}`);
    console.log(`👤 Signer(from / _msgSender): ${signer.address}`);
    console.log(`🚚 Relayer(tx sender / gas payer): ${relayer.address}`);
    console.log(`⛽ gas_call=${gasCall}  gas_execute=${gasExecute}  deadline(+secs)=${deadlineIn}`);
    console.log(`📦 amount=${amount.toString()}  🏷️ ref=${refCodeStr}`);

    // ---- contracts & interfaces ----
    const FwdFactory     = await ethers.getContractFactory('WhitelistForwarder', relayer);
    const VestingFactory = await ethers.getContractFactory('TokenVesting', signer);

    const forwarder    = FwdFactory.attach(forwarderAddr);
    const vestingRead  = VestingFactory.attach(tokenVestingAddr).connect(hre.ethers.provider);
    const vestingIface = VestingFactory.interface;

    // StableCoin(permit 지원) 컨트랙트: 프로젝트 아티팩트 이름에 맞춰 사용
    const usdt = await ethers.getContractAt('StableCoin', usdtAddr, hre.ethers.provider);
    const decimals  = await usdt.decimals();
    const symbol    = (await usdt.symbol?.().catch(() => 'TOKEN')) || 'TOKEN';
    const tokenName = (await usdt.name?.().catch(() => 'Token'))  || 'Token';

    // ---- 견적 및 레퍼럴 유효성 ----
    const required = await vestingRead.estimatedTotalAmount(amount, refCodeStr);
    if (required === 0n) throw new Error('❌ 유효하지 않은 레퍼럴 코드입니다. (estimatedTotalAmount가 0 반환)');
    console.log(`\n🧮 필요 ${symbol}: ${ethers.formatUnits(required, decimals)} ${symbol}`);

    // ---- PERMIT(EIP-2612) 서명 (owner=buyer, spender=TokenVesting) ----
    const permitNonce    = await usdt.nonces(signer.address);
    const permitDeadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 30); // +30m
    const permitDomain = {
        name: tokenName,
        version: '1',
        chainId,
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
        owner:    signer.address,
        spender:  tokenVestingAddr,
        value:    required,
        nonce:    permitNonce,
        deadline: permitDeadline,
    };
    console.log('\n📝 permit 서명 생성 중...');
    const permitSig = await signer.signTypedData(permitDomain, permitTypes, permitMsg);
    const { v, r, s } = ethers.Signature.from(permitSig);
    console.log('✅ permit 서명 완료');

    const p = { value: required, deadline: permitDeadline, v, r, s }; // TokenVesting.PermitData

    // ---- buyBox calldata ----
    const callData = vestingIface.encodeFunctionData('buyBox', [amount, refCodeStr, p]);

    // ---- allow-list 빠른 체크(선택) ----
    try {
        const buyBoxSel = Shared.selectorForBuyBox(vestingIface);
        const [_selEcho, allowed] = await forwarder.debugAllowed(tokenVestingAddr, callData);
        console.log(`🛡️ Forwarder allow-list for buyBox(${buyBoxSel}): ${allowed ? "ALLOWED ✅" : "NOT ALLOWED ❌"}`);
        if (!allowed) console.log('   • setAllowed(tokenVesting, selectorOf(buyBox), true) 먼저 설정하세요.');
    } catch {
        console.log('ℹ️ debugAllowed 호출 불가(ABI/권한 차이 가능) - 계속 진행합니다.');
    }

    // ---- ForwardRequest EIP-712 서명 ----
    // nonce
    let fwdNonce;
    try { fwdNonce = await forwarder.getNonce(signer.address); }
    catch { fwdNonce = await forwarder.nonces(signer.address); }
    fwdNonce = BigInt(fwdNonce.toString());

    const fwdDeadline = Math.floor(Date.now() / 1000) + deadlineIn; // uint48

    const domain = {
        name: 'WhitelistForwarder',
        version: '1',
        chainId,
        verifyingContract: forwarderAddr,
    };
    const types = {
        ForwardRequest: [
            { name: 'from',     type: 'address' },
            { name: 'to',       type: 'address' },
            { name: 'value',    type: 'uint256' },
            { name: 'gas',      type: 'uint256' },   // 내부 call 가스
            { name: 'nonce',    type: 'uint256' },
            { name: 'deadline', type: 'uint48'  },   // ← Forwarder 정의와 일치
            { name: 'data',     type: 'bytes'   },
        ],
    };
    const request = {
        from: signer.address,
        to: tokenVestingAddr,
        value: 0n,
        gas: gasCall,
        nonce: fwdNonce,
        deadline: fwdDeadline,
        data: callData,
    };

    console.log('\n🖋️ ForwardRequest 서명 생성 중...');
    const signature = await signer.signTypedData(domain, types, request);
    const recovered = ethers.verifyTypedData(domain, types, request, signature);
    console.log(`✅ 서명 완료. recovered=${recovered}`);

    if (recovered.toLowerCase() !== signer.address.toLowerCase()) {
        throw new Error('❌ 서명자 불일치 (recovered != signer)');
    }

    const requestWithSig = { ...request, signature };

    // ---- 실행 ----
    try {
        const ds = await forwarder.domainSeparator();
        console.log(`📎 forwarder.domainSeparator: ${ds}`);
    } catch {}

    console.log('\n🚚 forwarder.execute(requestWithSig) 호출 (릴레이어가 가스 지불)...');
    const tx = await forwarder.execute(requestWithSig, {
        value: request.value,     // 0
        gasLimit: gasExecute,     // 트xn 가스 상한
    });
    console.log(`⏳ Tx sent: ${tx.hash}`);
    const rc = await tx.wait();
    console.log(`✅ 실행 완료. status=${rc.status} block=${rc.blockNumber}`);
    console.log('🎉 위임대납 buyBox 완료!');
}

main().catch((e) => {
    const raw = e?.info?.error?.data?.data || e?.info?.error?.data || e?.data || e?.error?.data;
    console.error('❌ 실행 실패:', e?.shortMessage || e?.message || e);
    if (raw) {
        try { console.error('   • raw revert data:', typeof raw === 'string' ? raw : ethers.hexlify(raw)); }
        catch { console.error('   • raw revert data: (hex 변환 실패)'); }
    }
    process.exit(1);
});
