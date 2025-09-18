/* eslint-disable no-console */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const hre = require('hardhat');
const { ethers } = hre;
const Shared = require('./_shared'); // selectorForBuyBox 사용(선택)

/** 파일 로더 */
function loadJSON(rel) {
    const p = path.resolve(__dirname, rel);
    if (!fs.existsSync(p)) throw new Error(`❌ 파일을 찾을 수 없습니다: ${p}`);
    return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/** 레퍼럴 코드 8자 보장 */
function ensure8CharRef(s) {
    if (typeof s !== 'string' || s.length !== 8) {
        throw new Error('❌ refCodeStr는 정확히 8자여야 합니다 (A-Z/0-9).');
    }
    return s.toUpperCase();
}

/** 커스텀 에러/리버트 디코딩 */
function decodeRevert(e, forwarderIface, vestingIface, erc20Iface) {
    // A) provider가 이미 디코드한 경우
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

    // B) revert hex 추출 유틸 (Hardhat error.body 지원)
    const extractHex = (err) => {
        // 흔한 위치들
        let raw =
            err?.receipt?.revertReason ||
            err?.info?.error?.data?.data ||
            err?.info?.error?.data ||
            err?.data ||
            err?.error?.data ||
            err?.error?.error?.data ||
            null;

        // Hardhat HttpProvider: error.body(JSON string)에 들어있는 케이스
        if (!raw && typeof err?.error?.body === 'string') {
            try {
                const body = JSON.parse(err.error.body);
                raw =
                    body?.error?.data?.data ||
                    body?.error?.data ||
                    null;
            } catch {
                // ignore
            }
        }
        // hexlify
        try {
            if (!raw) return null;
            if (typeof raw === 'string') return raw;
            return ethers.hexlify(raw);
        } catch {
            return null;
        }
    };

    const asHex = extractHex(e);
    if (asHex && asHex.length >= 10) {
        // 1) Forwarder 커스텀 에러
        try {
            const err = forwarderIface.parseError(asHex);
            return { raw: asHex, decoded: `Forwarder.${err?.name}(${err?.args?.map(String).join(', ')})`, hint: null };
        } catch {}

        // 2) TokenVesting 커스텀 에러/require(string)
        try {
            const err = vestingIface.parseError(asHex);
            return { raw: asHex, decoded: `TokenVesting.${err?.name}(${err?.args?.map(String).join(', ')})`, hint: null };
        } catch {}

        // 3) ERC20 / ERC2612 표준 커스텀 에러
        try {
            const err = erc20Iface.parseError(asHex);
            return { raw: asHex, decoded: `ERC20.${err?.name}(${err?.args?.map(String).join(', ')})`, hint: null };
        } catch {}

        // 4) 마지막 셀렉터 힌트
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

    // C) 메시지 문자열 파싱(마지막 fallback)
    const msg = e?.shortMessage || e?.message || '';
    if (msg) {
        // custom error 'Name(args)'
        const m1 = msg.match(/custom error '([^']+)\((.*)\)'/i);
        if (m1) {
            return { raw: null, decoded: `${m1[1]}(${m1[2] ?? ''})`, hint: 'message 파싱' };
        }
        // reverted with reason string '...'
        const m2 = msg.match(/reason string '([^']+)'/i);
        if (m2) {
            return { raw: null, decoded: `Error("${m2[1]}")`, hint: 'message 파싱' };
        }
    }

    return { raw: asHex ?? null, decoded: null, hint: '리버트 데이터 없음/짧음' };
}


async function main() {
    console.log('🚀 buyBox (ERC2771 위임대납) 실행');

    // ---- env ----
    const { PRIVATE_KEY, OWNER_KEY } = process.env;
    if (!PRIVATE_KEY) throw new Error('❌ .env의 PRIVATE_KEY(구매자 서명자)가 필요합니다.');
    if (!OWNER_KEY) throw new Error('❌ .env의 OWNER_KEY(릴레이어)가 필요합니다.');

    // ---- load files ----
    const dep = loadJSON('./output/deployment-info.json');
    const dcfg = loadJSON('./input/delegateBuyBox.json'); // { amount, ref, deadline, gas_call, gas_execute }

    const forwarderAddr = dep?.forwarder;
    const tokenVestingAddr = dep?.contracts?.tokenVesting;
    const stableCoinAddr = dep?.contracts?.stableCoin;
    const recipientAddr = dep?.contracts?.recipient;

    if (!ethers.isAddress(forwarderAddr) || !ethers.isAddress(tokenVestingAddr) || !ethers.isAddress(stableCoinAddr)) {
        throw new Error('❌ deployment-info.json에서 forwarder/tokenVesting/stableCoin 주소를 읽지 못했습니다.');
    }

    const amount = BigInt(dcfg?.amount ?? 0);
    const refCodeStr = ensure8CharRef(dcfg?.ref ?? '');
    if (!amount || amount <= 0n) throw new Error('❌ delegateBuyBox.json 의 amount가 유효하지 않습니다.');

    // delegate 설정 (없으면 기본값)
    const gasCall = BigInt(dcfg?.gas_call ?? 1_500_000);
    const gasExecute = BigInt(dcfg?.gas_execute ?? 3_000_000);
    const deadlineIn = Number(dcfg?.deadline ?? 3600); // seconds → uint48

    // ---- provider & wallets ----
    const signer = new ethers.Wallet(PRIVATE_KEY, hre.ethers.provider); // 구매자(_msgSender)
    const relayer = new ethers.Wallet(OWNER_KEY, hre.ethers.provider); // 가스 지불자
    const buyerAddr = signer.address;
    const relayerAddr = relayer.address;

    const chain = await hre.ethers.provider.getNetwork();
    const chainId = Number(chain.chainId);

    console.log(`🔗 Network: chainId=${chainId} (${hre.network.name})`);
    console.log(`🧭 Forwarder: ${forwarderAddr}`);
    console.log(`📦 TokenVesting: ${tokenVestingAddr}`);
    console.log(`💵 StableCoin: ${stableCoinAddr}`);
    console.log(`👤 Signer(from / _msgSender): ${buyerAddr}`);
    console.log(`🚚 Relayer(tx sender / gas payer): ${relayerAddr}`);
    console.log(`⛽ gas_call=${gasCall}  gas_execute=${gasExecute}  deadline(+secs)=${deadlineIn}`);
    console.log(`📦 amount=${amount.toString()}  🏷️ ref=${refCodeStr}`);

    // ---- contracts & interfaces ----
    const FwdFactory = await ethers.getContractFactory('WhitelistForwarder', relayer);
    const VestingFactory = await ethers.getContractFactory('TokenVesting', signer);

    const forwarder = FwdFactory.attach(forwarderAddr);
    const vestingRead = VestingFactory.attach(tokenVestingAddr).connect(hre.ethers.provider);
    const vestingIface = VestingFactory.interface;

    // StableCoin(permit 지원) 컨트랙트
    const stableCoin = await ethers.getContractAt('StableCoin', stableCoinAddr, hre.ethers.provider);
    const decimals = await stableCoin.decimals();
    const symbol =
    (await (typeof stableCoin?.symbol === 'function'
        ? stableCoin.symbol().catch(() => undefined)
        : Promise.resolve(undefined))) ?? 'TOKEN';
    const tokenName =
    (await (typeof stableCoin?.name === 'function'
        ? stableCoin.name().catch(() => undefined)
        : Promise.resolve(undefined))) ?? 'Token';
    const version =
    (await (typeof stableCoin?.version === 'function'
        ? stableCoin.version().catch(() => undefined)
        : Promise.resolve(undefined))) ?? '1';
    const erc20Iface = stableCoin.interface;

    // ---- 견적 및 레퍼럴 유효성 ----
    const required = await vestingRead.estimatedTotalAmount(amount, refCodeStr);
    if (required === 0n) throw new Error('❌ 유효하지 않은 레퍼럴 코드입니다. (estimatedTotalAmount가 0 반환)');
    console.log(`\n🧮 필요 ${symbol}: ${ethers.formatUnits(required, decimals)} ${symbol}`);

    // ---- PERMIT(EIP-2612) 서명 (owner=buyer, spender=TokenVesting) ----
    const permitNonce = await stableCoin.nonces(buyerAddr);
    const permitDeadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 30); // +30m
    const permitDomain = {
        name: tokenName,
        version: version,
        chainId,
        verifyingContract: stableCoinAddr,
    };
    const permitTypes = {
        Permit: [
            { name: 'owner', type: 'address' },
            { name: 'spender', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'nonce', type: 'uint256' },
            { name: 'deadline', type: 'uint256' },
        ],
    };
    const permitMsg = {
        owner: buyerAddr,
        spender: tokenVestingAddr,
        value: required,
        nonce: permitNonce,
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
    const ethOf = async (addr) => ethers.formatEther(await hre.ethers.provider.getBalance(addr));
    const buyerEthBefore = await ethOf(buyerAddr);
    const relayerEthBefore = await ethOf(relayerAddr);
    console.log('\n⛽ ETH 잔액 (호출 전)');
    console.log(`    • buyer   : ${buyerEthBefore} ETH`);
    console.log(`    • relayer : ${relayerEthBefore} ETH`);

    // ========= 잔액 점검 & 자동 충전 =========
    let buyerBal = await stableCoin.balanceOf(buyerAddr);
    const vestingBal = await stableCoin.balanceOf(tokenVestingAddr);
    const recipBal = recipientAddr ? await stableCoin.balanceOf(recipientAddr) : 0n;
    const totalBoxesBefore = await vestingRead.getTotalBoxPurchased();
    const totalRefsBefore = await vestingRead.getTotalReferralUnits();

    console.log('\n💰 현재 잔액');
    console.log(`    • buyer(${buyerAddr})         : ${ethers.formatUnits(buyerBal, decimals)} ${symbol}`);
    console.log(`    • vesting(${tokenVestingAddr}): ${ethers.formatUnits(vestingBal, decimals)} ${symbol}`);
    if (recipientAddr) {
        console.log(`    • recipient(${recipientAddr})  : ${ethers.formatUnits(recipBal, decimals)} ${symbol}`);
    }
    console.log('📦 현재까지 구매된 박스 총량:', totalBoxesBefore.toString());
    console.log('📦 현재까지 레퍼럴된 박스 총량:', totalRefsBefore.toString());

    if (buyerBal < required) {
        const ownerBase = new ethers.Wallet(OWNER_KEY, hre.ethers.provider);
        const ownerAddr = await ownerBase.getAddress();
        const need = required - buyerBal;
        const ownerBal = await stableCoin.balanceOf(ownerAddr);

        console.log(`\n🤝 USDT 자동 충전: owner(${ownerAddr}) → buyer(${buyerAddr})`);
        console.log(`    • 필요한 금액 : ${ethers.formatUnits(need, decimals)} ${symbol}`);
        console.log(`    • owner 잔액 : ${ethers.formatUnits(ownerBal, decimals)} ${symbol}`);

        if (ownerBal < need) {
            throw new Error(
                `❌ OWNER의 USDT 부족: 필요=${ethers.formatUnits(need, decimals)} ${symbol}, 보유=${ethers.formatUnits(ownerBal, decimals)} ${symbol}`
            );
        }

        const txFund = await stableCoin.connect(ownerBase).transfer(buyerAddr, need);
        if (Shared?.withGasLog) {
            await Shared.withGasLog('[fund] owner→buyer USDT', Promise.resolve(txFund), {}, 'setup');
        }
        const rcFund = await txFund.wait();
        console.log('✅ 충전 완료. txHash:', rcFund.hash);

        // 충전 후 buyer 잔액 재조회
        buyerBal = await stableCoin.balanceOf(buyerAddr);
        console.log(`    • 충전 후 buyer 잔액: ${ethers.formatUnits(buyerBal, decimals)} ${symbol}`);
    }

    if (buyerBal < required) {
        throw new Error(
            `❌ 잔액 부족: 필요=${ethers.formatUnits(required, decimals)} ${symbol}, 보유=${ethers.formatUnits(buyerBal, decimals)} ${symbol}`
        );
    }
    // =======================================

    // ---- ForwardRequest EIP-712 서명 ----
    let fwdNonce;
    try {
        fwdNonce = await forwarder.getNonce(buyerAddr);
    } catch {
        fwdNonce = await forwarder.nonces(buyerAddr);
    }
    fwdNonce = BigInt(fwdNonce.toString());

    const fwdDeadline = Math.floor(Date.now() / 1000) + deadlineIn; // uint48

    // !!! 타입 순서 매우 중요 (deadline → data)!
    const domain = {
        name: 'WhitelistForwarder',
        version: '1',
        chainId,
        verifyingContract: forwarderAddr,
    };
    const types = {
        ForwardRequest: [
            { name: 'from', type: 'address' },
            { name: 'to', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'gas', type: 'uint256' }, // 내부 call 가스
            { name: 'nonce', type: 'uint256' },
            { name: 'deadline', type: 'uint48' }, // ← Forwarder 정의와 일치
            { name: 'data', type: 'bytes' },
        ],
    };
    const request = {
        from: buyerAddr,
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
    if (recovered.toLowerCase() !== buyerAddr.toLowerCase()) {
        throw new Error('❌ 서명자 불일치 (recovered != signer)');
    }

    const requestWithSig = { ...request, signature };

    // ---- 실행(메타TX) ----
    try {
        const ds = await forwarder.domainSeparator();
        console.log(`📎 forwarder.domainSeparator: ${ds}`);
    } catch {}

    // --- execute 직전에 프리플라이트 ---
    try {
        await forwarder.execute.staticCall(requestWithSig, {
            value: request.value,
            gasLimit: gasExecute,
        });
        // callStatic 통과 시에만 실제 트랜잭션 진행
    } catch (preErr) {
        console.log(preErr)
        const info = decodeRevert(preErr, FwdFactory.interface, vestingIface, erc20Iface);
        console.error('❌ callStatic 프리체크 실패(해석):', info.decoded || '(미해석)');
        if (info.hint) console.error('   • hint:', info.hint);
        if (info.raw) console.error('   • raw:', info.raw);
        throw preErr; // 중단
    }

    // --- 실행 전 상태 스냅샷 ---
    const buyerUSDTBefore     = await stableCoin.balanceOf(buyerAddr);
    const vestingUSDTBefore   = await stableCoin.balanceOf(tokenVestingAddr);
    const recipientUSDTBefore = recipientAddr ? await stableCoin.balanceOf(recipientAddr) : 0n;
    const totalBoxes0         = await vestingRead.getTotalBoxPurchased();
    const totalRefs0          = await vestingRead.getTotalReferralUnits();

    console.log('\n🚚 forwarder.execute(requestWithSig) 호출 (릴레이어가 가스 지불)...');
    let rc;
    try {
        const tx = await forwarder.execute(requestWithSig, {
            value: request.value,   // 0
            gasLimit: gasExecute,   // 트xn 가스 상한
        });
        console.log(`⏳ Tx sent: ${tx.hash}`);
        rc = await tx.wait();
        console.log(`✅ 실행 완료. status=${rc.status} block=${rc.blockNumber}`);
    } catch (err) {
        const info = decodeRevert(err, FwdFactory.interface, vestingIface, erc20Iface);
        console.error('❌ execute 실패(해석):', info.decoded || '(미해석)');
        if (info.hint) console.error('   • hint:', info.hint);
        if (info.raw) console.error('   • raw:', info.raw);
        throw err;
    }

    // --- 실행 후 검증 ---
    const buyerUSDTAfter      = await stableCoin.balanceOf(buyerAddr);
    const vestingUSDTAfter    = await stableCoin.balanceOf(tokenVestingAddr);
    const recipientUSDTAfter  = recipientAddr ? await stableCoin.balanceOf(recipientAddr) : 0n;
    const totalBoxes1         = await vestingRead.getTotalBoxPurchased();
    const totalRefs1          = await vestingRead.getTotalReferralUnits();

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
    const buyerEthAfter = await ethOf(buyerAddr);
    const relayerEthAfter = await ethOf(relayerAddr);
    console.log('\n⛽ ETH 잔액 (호출 후)');
    console.log(`    • buyer   : ${buyerEthAfter} ETH`);
    console.log(`    • relayer : ${relayerEthAfter} ETH`);

    console.log('🎉 위임대납 buyBox 완료!');
}

main().catch((e) => {
    const { ethers } = require('hardhat');
    console.error('❌ 실행 실패:', e?.shortMessage || e?.message || e);
    const raw =
        e?.info?.error?.data?.data ||
        e?.info?.error?.data ||
        e?.data ||
        e?.error?.data ||
        e?.error?.error?.data ||
        null;
    if (raw) {
        try {
            console.error('   • raw revert data:', typeof raw === 'string' ? raw : ethers.hexlify(raw));
        } catch {
            console.error('   • raw revert data: (hex 변환 실패)');
        }
    }
    process.exit(1);
});
