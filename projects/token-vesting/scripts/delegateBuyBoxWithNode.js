/* eslint-disable no-console */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const Shared = require('./_shared'); // selectorForBuyBox 사용(선택)

/** 파일 로더 */
function loadJSON(rel) {
    const p = path.resolve(__dirname, rel);
    if (!fs.existsSync(p)) throw new Error(`❌ 파일을 찾을 수 없습니다: ${p}`);
    return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/** ABI 로더 (Node 전용) */
function loadAbi(rel) {
    const p = path.resolve(__dirname, rel);
    if (!fs.existsSync(p)) throw new Error(`❌ ABI 파일을 찾을 수 없습니다: ${p}`);
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!j.abi) throw new Error(`❌ ABI 키(abi)를 찾을 수 없습니다: ${p}`);
    return j.abi;
}

/** 레퍼럴 코드 8자 보장 */
function ensure8CharRef(s) {
    if (typeof s !== 'string' || s.length !== 8) {
        throw new Error('❌ refCodeStr는 정확히 8자여야 합니다 (A-Z/0-9).');
    }
    return s.toUpperCase();
}

/** 커스텀 에러/리버트 디코딩 (강화판) */
function decodeRevert(e, forwarderIface, vestingIface, erc20Iface) {
    // 1) provider가 직접 디코드해준 경우 우선 사용
    const directName =
        e?.errorName || e?.data?.errorName || e?.error?.errorName || e?.info?.error?.errorName || null;
    const directArgs =
        e?.errorArgs || e?.data?.errorArgs || e?.error?.errorArgs || e?.info?.error?.errorArgs || null;

    if (directName) {
        try {
            const argsStr = Array.isArray(directArgs) ? directArgs.map(String).join(', ') : '';
            return { raw: null, decoded: `${directName}(${argsStr})`, hint: 'provider가 직접 디코드함' };
        } catch {
            return { raw: null, decoded: directName, hint: 'provider가 직접 디코드함' };
        }
    }

    // 2) revert hex 추출
    const extractHex = (err) => {
        let raw =
            err?.receipt?.revertReason ||
            err?.info?.error?.data?.data ||
            err?.info?.error?.data ||
            err?.data ||
            err?.error?.data ||
            err?.error?.error?.data ||
            null;

        if (!raw && typeof err?.error?.body === 'string') {
            try {
                const body = JSON.parse(err.error.body);
                raw = body?.error?.data?.data || body?.error?.data || null;
            } catch {}
        }
        try {
            if (!raw) return null;
            if (typeof raw === 'string') return raw;
            return ethers.hexlify(raw);
        } catch {
            return null;
        }
    };

    const asHex = extractHex(e);

    // 3) 안전 파서
    const tryParse = (iface, hex, label) => {
        try {
            const desc = iface.parseError(hex);
            if (desc && desc.name) {
                const argsStr = (desc.args ? Array.from(desc.args).map(String).join(', ') : '');
                return `${label}.${desc.name}(${argsStr})`;
            }
        } catch {}
        return null;
    };

    if (asHex && asHex.length >= 10) {
        // **순서 중요: ERC20 → Vesting → Forwarder**
        let decoded =
            tryParse(erc20Iface, asHex, 'ERC20') ||
            tryParse(vestingIface, asHex, 'TokenVesting') ||
            tryParse(forwarderIface, asHex, 'Forwarder');

        if (decoded) return { raw: asHex, decoded, hint: null };

        // 4) 알려진 셀렉터 매핑
        const selectorMap = {
            ERC2771ForwarderMismatchedValue: '0x1f5c50f0',
            NotWhitelisted: '0xe0a8f8c6',
            SelectorNotAllowed: '0x5fb4d40d',
            ERC2771UntrustfulTarget: '0x3e09eeff',
            ERC2771ForwarderExpiredRequest: '0x5c873ca1',
            ERC2771ForwarderInvalidSigner: '0x28998c5f',
            ERC2612ExpiredSignature: '0x52f13ef7',
            ERC2612InvalidSigner: '0x3c43d9b1',
            ERC20InvalidApprover: '0x6f5e8818',
            ERC20InvalidSpender: '0x1f3f3a75',
            ERC20InsufficientAllowance: '0x13be252b',
            ERC20InvalidSender: '0x17f9c883',
            ERC20InvalidReceiver: '0x9a89f93e',
            ERC20InsufficientBalance: '0xe450d38c',
        };
        const sel = asHex.slice(0, 10);
        for (const [name, sig] of Object.entries(selectorMap)) {
            if (sel === sig) {
                return { raw: asHex, decoded: name, hint: 'selector 매칭' };
            }
        }
    }

    // 5) 메시지 문자열 fallback
    const msg = e?.shortMessage || e?.message || '';
    if (msg) {
        const m1 = msg.match(/custom error '([^']+)\((.*)\)'/i);
        if (m1) return { raw: null, decoded: `${m1[1]}(${m1[2] ?? ''})`, hint: 'message 파싱' };
        const m2 = msg.match(/reason string '([^']+)'/i);
        if (m2) return { raw: null, decoded: `Error("${m2[1]}")`, hint: 'message 파싱' };
    }

    return { raw: asHex ?? null, decoded: null, hint: '리버트 데이터 없음/짧음' };
}


async function main() {
    console.log('🚀 buyBox (ERC2771 위임대납) 실행 [Node/ethers 전용]');

    // ---- env ----
    const { PRIVATE_KEY, OWNER_KEY, PROVIDER_URL } = process.env;
    if (!PRIVATE_KEY) throw new Error('❌ .env의 PRIVATE_KEY(구매자 서명자)가 필요합니다.');
    if (!OWNER_KEY)   throw new Error('❌ .env의 OWNER_KEY(릴레이어)가 필요합니다.');

    // ---- provider & wallets ----
    const provider = new ethers.JsonRpcProvider(PROVIDER_URL || 'http://127.0.0.1:8545');
    const signer   = new ethers.Wallet(PRIVATE_KEY, provider); // 구매자(_msgSender)
    const relayer  = new ethers.Wallet(OWNER_KEY,   provider); // 가스 지불자
    const buyerAddr   = signer.address;
    const relayerAddr = relayer.address;

    // ---- load files ----
    const dep  = loadJSON('./output/deployment-info.json');
    const dcfg = loadJSON('./data/delegateBuyBox.json'); // { amount, ref, deadline, gas_call, gas_execute }

    const forwarderAddr    = dep?.forwarder;
    const tokenVestingAddr = dep?.contracts?.tokenVesting;
    const usdtAddr         = dep?.contracts?.stableCoin;
    const recipientAddr    = dep?.contracts?.recipient;

    if (!ethers.isAddress(forwarderAddr) || !ethers.isAddress(tokenVestingAddr) || !ethers.isAddress(usdtAddr)) {
        throw new Error('❌ deployment-info.json에서 forwarder/tokenVesting/stableCoin 주소를 읽지 못했습니다.');
    }

    const amount     = BigInt(dcfg?.amount ?? 0);
    const refCodeStr = ensure8CharRef(dcfg?.ref ?? '');
    if (!amount || amount <= 0n) throw new Error('❌ delegateBuyBox.json 의 amount가 유효하지 않습니다.');

    // delegate 설정 (없으면 기본값)
    const gasCall    = BigInt(dcfg?.gas_call    ?? 1_500_000);
    const gasExecute = BigInt(dcfg?.gas_execute ?? 3_000_000);
    const deadlineIn = Number(dcfg?.deadline    ?? 3600); // seconds → uint48

    // ---- load ABIs (Node 전용: artifacts에서 직접 읽기) ----
    // 스크립트가 projects/token-vesting/scripts/ 안에 있다고 가정한 상대경로
    const fwdAbi   = loadAbi('../artifacts/contracts/Forwarder.sol/WhitelistForwarder.json');
    const vestAbi  = loadAbi('../artifacts/contracts/TokenVesting.sol/TokenVesting.json');
    const erc20Abi = loadAbi('../artifacts/contracts/Usdt.sol/StableCoin.json');

    const forwarderIface = new ethers.Interface(fwdAbi);
    const vestingIface   = new ethers.Interface(vestAbi);
    const erc20Iface     = new ethers.Interface(erc20Abi);

    // ---- contracts ----
    const forwarder  = new ethers.Contract(forwarderAddr, fwdAbi, relayer);     // execute는 릴레이어가 보냄
    const vestingRO  = new ethers.Contract(tokenVestingAddr, vestAbi, provider); // read-only
    const usdt       = new ethers.Contract(usdtAddr, erc20Abi, provider);

    const { chainId } = await provider.getNetwork();
    console.log(`🔗 Network: chainId=${Number(chainId)}`);
    console.log(`🧭 Forwarder: ${forwarderAddr}`);
    console.log(`📦 TokenVesting: ${tokenVestingAddr}`);
    console.log(`💵 StableCoin: ${usdtAddr}`);
    console.log(`👤 Signer(from / _msgSender): ${buyerAddr}`);
    console.log(`🚚 Relayer(tx sender / gas payer): ${relayerAddr}`);
    console.log(`⛽ gas_call=${gasCall}  gas_execute=${gasExecute}  deadline(+secs)=${deadlineIn}`);
    console.log(`📦 amount=${amount.toString()}  🏷️ ref=${refCodeStr}`);

    // ---- 견적 및 레퍼럴 유효성 ----
    const decimals  = await usdt.decimals();
    const symbol    = (await usdt.symbol?.().catch(() => 'TOKEN')) || 'TOKEN';
    const tokenName = (await usdt.name?.().catch(() => 'Token'))  || 'Token';

    const required = await vestingRO.estimatedTotalAmount(amount, refCodeStr);
    if (required === 0n) throw new Error('❌ 유효하지 않은 레퍼럴 코드입니다. (estimatedTotalAmount가 0 반환)');
    console.log(`\n🧮 필요 ${symbol}: ${ethers.formatUnits(required, decimals)} ${symbol}`);

    // ---- PERMIT(EIP-2612) 서명 (owner=buyer, spender=TokenVesting) ----
    const permitNonce    = await usdt.nonces(buyerAddr);
    const permitDeadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 30); // +30m
    const permitDomain = {
        name: tokenName,
        version: '1',
        chainId: Number(chainId),
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
    const permitSig = await signer.signTypedData(permitDomain, permitTypes, permitMsg);
    const { v, r, s } = ethers.Signature.from(permitSig);
    console.log('✅ permit 서명 완료');

    const p = { value: required, deadline: permitDeadline, v, r, s }; // TokenVesting.PermitData

    // ---- buyBox calldata ----
    const callData = vestingIface.encodeFunctionData('buyBox', [amount, refCodeStr, p]);

    // ---- allow-list 빠른 체크(권장: public getter 사용) ----
    try {
        const buyBoxSel = Shared.selectorForBuyBox(vestingIface);
        const allowed = await forwarder.isAllowed(tokenVestingAddr, buyBoxSel);
        console.log(`🛡️ Forwarder allow-list for buyBox(${buyBoxSel}): ${allowed ? 'ALLOWED ✅' : 'NOT ALLOWED ❌'}`);
        if (!allowed) console.log('   • setAllowed(tokenVesting, selectorOf(buyBox), true) 먼저 설정하세요.');
    } catch {
        console.log('ℹ️ forwarder.isAllowed 조회 실패(ABI/권한 차이 가능) - 계속 진행합니다.');
    }

    // ---- 실행 전 ETH 잔액 ----
    const ethOf = async (addr) => ethers.formatEther(await provider.getBalance(addr));
    const buyerEthBefore   = await ethOf(buyerAddr);
    const relayerEthBefore = await ethOf(relayerAddr);
    console.log('\n⛽ ETH 잔액 (호출 전)');
    console.log(`    • buyer   : ${buyerEthBefore} ETH`);
    console.log(`    • relayer : ${relayerEthBefore} ETH`);

    // ========= (옵션) 잔액 점검/자동충전 블럭은 필요시 재활성화 =========
    let buyerBal = await usdt.balanceOf(buyerAddr);
    const vestingBal = await usdt.balanceOf(tokenVestingAddr);
    const recipBal = recipientAddr ? await usdt.balanceOf(recipientAddr) : 0n;
    const totalBoxesBefore = await vestingRO.getTotalBoxPurchased();
    const totalRefsBefore  = await vestingRO.getTotalReferralUnits();

    console.log('\n💰 현재 잔액');
    console.log(`    • buyer(${buyerAddr})         : ${ethers.formatUnits(buyerBal, decimals)} ${symbol}`);
    console.log(`    • vesting(${tokenVestingAddr}): ${ethers.formatUnits(vestingBal, decimals)} ${symbol}`);
    if (recipientAddr) {
        console.log(`    • recipient(${recipientAddr})  : ${ethers.formatUnits(recipBal, decimals)} ${symbol}`);
    }
    console.log('📦 현재까지 구매된 박스 총량:', totalBoxesBefore.toString());
    console.log('📦 현재까지 레퍼럴된 박스 총량:', totalRefsBefore.toString());
    // ===============================================================

    // ---- ForwardRequest EIP-712 서명 ----
    let fwdNonce;
    try { fwdNonce = await forwarder.getNonce(buyerAddr); }
    catch { fwdNonce = await forwarder.nonces(buyerAddr); }
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
            { name: 'deadline', type: 'uint48'  }, // 순서 중요!
            { name: 'data',     type: 'bytes'   },
        ],
    };
    const request = {
        from:     buyerAddr,
        to:       tokenVestingAddr,
        value:    0n,
        gas:      gasCall,
        nonce:    fwdNonce,
        deadline: fwdDeadline,
        data:     callData,
    };

    console.log('\n🖋️ ForwardRequest 서명 생성 중...');
    const signature = await signer.signTypedData(domain, types, request);
    const recovered = ethers.verifyTypedData(domain, types, request, signature);
    console.log(`✅ 서명 완료. recovered=${recovered}`);
    if (recovered.toLowerCase() !== buyerAddr.toLowerCase()) {
        throw new Error('❌ 서명자 불일치 (recovered != signer)');
    }
    const requestWithSig = { ...request, signature };

    // ---- 프리플라이트(staticCall) ----
    try {
        await forwarder.execute.staticCall(requestWithSig, {
            value: request.value,
            gasLimit: gasExecute,
        });
    } catch (preErr) {
        const info = decodeRevert(preErr, forwarderIface, vestingIface, erc20Iface);
        console.error('❌ callStatic 프리체크 실패(해석):', info.decoded || '(미해석)');
        if (info.hint) console.error('   • hint:', info.hint);
        if (info.raw)  console.error('   • raw :', info.raw);
        throw preErr;
    }

    // ---- 실행 전 스냅샷 ----
    const buyerUSDTBefore    = await usdt.balanceOf(buyerAddr);
    const vestingUSDTBefore  = await usdt.balanceOf(tokenVestingAddr);
    const recipientUSDTBefore = recipientAddr ? await usdt.balanceOf(recipientAddr) : 0n;
    const totalBoxes0 = await vestingRO.getTotalBoxPurchased();
    const totalRefs0  = await vestingRO.getTotalReferralUnits();

    // ---- 실제 실행 ----
    console.log('\n🚚 forwarder.execute(requestWithSig) 호출 (릴레이어가 가스 지불)...');
    let rc;
    try {
        const tx = await forwarder.execute(requestWithSig, {
            value: request.value,
            gasLimit: gasExecute,
        });
        console.log(`⏳ Tx sent: ${tx.hash}`);
        rc = await tx.wait();
        console.log(`✅ 실행 완료. status=${rc.status} block=${rc.blockNumber}`);
    } catch (err) {
        const info = decodeRevert(err, forwarderIface, vestingIface, erc20Iface);
        console.error('❌ execute 실패(해석):', info.decoded || '(미해석)');
        if (info.hint) console.error('   • hint:', info.hint);
        if (info.raw)  console.error('   • raw :', info.raw);
        throw err;
    }

    // ---- 실행 후 검증 ----
    const buyerUSDTAfter     = await usdt.balanceOf(buyerAddr);
    const vestingUSDTAfter   = await usdt.balanceOf(tokenVestingAddr);
    const recipientUSDTAfter = recipientAddr ? await usdt.balanceOf(recipientAddr) : 0n;
    const totalBoxes1 = await vestingRO.getTotalBoxPurchased();
    const totalRefs1  = await vestingRO.getTotalReferralUnits();

    const spent = buyerUSDTBefore - buyerUSDTAfter;
    console.log('\n🧾 결과 검증');
    console.log(`    • buyer USDT 변화: -${ethers.formatUnits(spent < 0n ? 0n : spent, decimals)} ${symbol} (예상: ${ethers.formatUnits(required, decimals)})`);
    console.log(`    • vesting USDT   : ${ethers.formatUnits(vestingUSDTAfter - vestingUSDTBefore, decimals)} ${symbol}`);
    if (recipientAddr) {
        console.log(`    • recipient USDT : ${ethers.formatUnits(recipientUSDTAfter - recipientUSDTBefore, decimals)} ${symbol}`);
    }
    console.log(`    • 총 박스 수    : ${totalBoxes0} → ${totalBoxes1} (증가 기대치 ≥ ${amount})`);
    console.log(`    • 총 레퍼럴 수  : ${totalRefs0} → ${totalRefs1} (증가 기대치 ≥ ${amount})`);

    // ---- 실행 후 ETH 잔액 ----
    const buyerEthAfter   = await ethOf(buyerAddr);
    const relayerEthAfter = await ethOf(relayerAddr);
    console.log('\n⛽ ETH 잔액 (호출 후)');
    console.log(`    • buyer   : ${buyerEthAfter} ETH`);
    console.log(`    • relayer : ${relayerEthAfter} ETH`);

    console.log('🎉 위임대납 buyBox 완료!');
}

main().catch((e) => {
    console.error('❌ 실행 실패:', e?.shortMessage || e?.message || e);
    const hex =
        e?.info?.error?.data?.data ||
        e?.info?.error?.data ||
        e?.data ||
        e?.error?.data ||
        e?.error?.error?.data ||
        (typeof e?.error?.body === 'string' ? (() => { try { return JSON.parse(e.error.body)?.error?.data?.data || JSON.parse(e.error.body)?.error?.data || null; } catch { return null; } })() : null);
    if (hex) {
        try { console.error('   • raw revert data:', typeof hex === 'string' ? hex : ethers.hexlify(hex)); }
        catch { console.error('   • raw revert data: (hex 변환 실패)'); }
    }
    process.exit(1);
});
