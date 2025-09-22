/* eslint-disable no-console */
/**
 * @fileoverview
 *  scenario.03 — 지정 시각(01:00/13:00) 기준 지표 출력 + 2026-06-01 12:00 A/B 클레임 반영
 */

const fs = require('fs');
const path = require('path');
const { ethers } = require('hardhat');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// -----------------------------------------------------------------------------
// 상수: 스케줄/시각
// -----------------------------------------------------------------------------
const VEST_START = 1748822400n; // 2025-06-02 00:00:00 UTC
const VEST_ENDS = [
    1780271999n, // 2026-05-31 23:59:59
    1811807999n, // 2027-05-31 23:59:59
    1843430399n, // 2028-05-31 23:59:59
    1874966399n, // 2029-05-31 23:59:59
];
const BUYER_TOTALS = [
    '170000000', // 170M
    '87500000',  // 87.5M
    '52500000',  // 52.5M
    '40000000',  // 40M
].map(ethers.parseEther);
const REF_TOTALS = [
    '15000000',  // 15M
    '15000000',  // 15M
    '0',
    '0',
].map(ethers.parseEther);

// CSV 경로
const DATA_DIR = path.resolve(__dirname, './data');
const USER_CSV = path.join(DATA_DIR, 'user.csv');
const PURCHASE_CSV = path.join(DATA_DIR, 'purchase_history.csv');
const SENDBOX_CSV = path.join(DATA_DIR, 'sendbox_history.csv');

// 대상 지갑들
const WALLET_X = ethers.getAddress('0x5989B53ee3E58a5435eefa44Bebfe6fdbb27Ba29');
const WALLET_A = ethers.getAddress('0x70997970C51812dc3A010C7d01b50e0d17dc79C8');
const WALLET_B = ethers.getAddress('0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC');

describe('scenario.03 — 01:00/13:00 시점 지표 + 2026-06-01 12:00 클레임', function () {
    let owner, forwarder, stableCoin, vesting, token;

    // -------------------------------------------------------------------------
    // 유틸
    // -------------------------------------------------------------------------
    function readCsv(p) {
        const t = fs.readFileSync(p, 'utf8');
        return t.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    }

    function parseUsersCsv() {
        if (!fs.existsSync(USER_CSV)) return [];
        const lines = readCsv(USER_CSV);
        const header = lines[0].split(',').map((s) => s.trim().toLowerCase());
        const wIdx = header.indexOf('wallet_address');
        const cIdx = header.indexOf('referral_code');
        const out = [];
        for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(',').map((s) => s.trim());
            const wallet = cols[wIdx];
            const code = cols[cIdx];
            if (wallet && code) out.push({ wallet: ethers.getAddress(wallet), code: String(code).toUpperCase() });
        }
        return out;
    }

    function parsePurchasesCsv() {
        if (!fs.existsSync(PURCHASE_CSV)) return [];
        const lines = readCsv(PURCHASE_CSV);
        const header = lines[0].split(',').map((s) => s.trim().toLowerCase());
        const idx = {
            wallet: header.indexOf('wallet_address'),
            ref: header.indexOf('referral'),
            amount: header.indexOf('amount'),
            price: header.indexOf('avg_price'),
            time: header.indexOf('updated_at'),
        };
        const out = [];
        for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(',').map((s) => s.trim());
            const wallet = ethers.getAddress(cols[idx.wallet]);
            const ref = String(cols[idx.ref] || '').toUpperCase();
            const amount = BigInt(String(cols[idx.amount]).replace(/[^\d]/g, ''));
            const priceStr = cols[idx.price] || '300';
            const timeStr = cols[idx.time];
            const ms = Date.parse(timeStr.replace(' ', 'T') + 'Z');
            const purchaseTs = BigInt(Math.floor(ms / 1000));
            const price6 = BigInt(String(priceStr).split('.')[0] || '0') * 10n ** 6n +
                BigInt(((String(priceStr).split('.')[1] || '') + '000000').slice(0, 6));
            const paidUnits = amount * price6;
            out.push({ wallet, ref, amount, purchaseTs, paidUnits });
        }
        out.sort((a, b) => Number(a.purchaseTs - b.purchaseTs));
        return out;
    }

    function parseSendboxCsv() {
        if (!fs.existsSync(SENDBOX_CSV)) return [];
        const lines = readCsv(SENDBOX_CSV);
        const header = lines[0].split(',').map((s) => s.trim().toLowerCase());
        const idx = {
            from: header.indexOf('from_wallet_address'),
            to: header.indexOf('to_wallet_address'),
            amount: header.indexOf('amount'),
            time: header.indexOf('updated_at'),
        };
        const out = [];
        for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(',').map((s) => s.trim());
            const from = ethers.getAddress(cols[idx.from]);
            const to = ethers.getAddress(cols[idx.to]);
            const amount = BigInt(String(cols[idx.amount]).replace(/[^\d]/g, ''));
            const timeStr = cols[idx.time];
            const ms = Date.parse(timeStr.replace(' ', 'T') + 'Z');
            const transferTs = BigInt(Math.floor(ms / 1000));
            out.push({ from, to, amount, transferTs });
        }
        out.sort((a, b) => Number(a.transferTs - b.transferTs));
        return out;
    }

    const TEN = 10n;
    const pow10 = (n) => TEN ** BigInt(n);
    function formatAmount(bn, decimals) {
        let v = BigInt(bn);
        const neg = v < 0n;
        if (neg) v = -v;
        const base = pow10(decimals);
        const intPart = v / base;
        const fracPart = v % base;
        const fracStr = fracPart.toString().padStart(decimals, '0');
        return `${neg ? '-' : ''}${intPart.toString()}.${fracStr}`;
    }
    const to2dec = (x18) => BigInt(x18) / pow10(16);

    async function printFourMetricsAt(vesting, user, ts, claimedBuyer18 = 0n, claimedRef18 = 0n) {
        const buyCurrent18 = await vesting.previewBuyerClaimableAt(user, ts);
        const buyY18     = await vesting.previewBuyerEarnedYesterday(user);
        const refCurrent18 = await vesting.previewReferrerClaimableAt(user, ts);
        const refY18     = await vesting.previewReferrerEarnedYesterday(user);
        const boxBal     = await vesting.buyerBoxesAtTs(user, ts);
        const refUnits   = await vesting.referralUnitsAtTs(user, ts);

        console.log(`[METRICS] ${user} @ ${ts}`);
        console.log('    box count         :', boxBal.toString());
        
        console.log('    buyer claimed (2dec):', formatAmount(to2dec(claimedBuyer18), 2));
        console.log('    buyer current (2dec) :', formatAmount(to2dec(buyCurrent18), 2));
        console.log('    buyer total (2dec) :', formatAmount(to2dec(claimedBuyer18 + buyCurrent18), 2));
        console.log('    buyer last  (2dec) :', formatAmount(to2dec(buyY18),     2));
        console.log('    referral units    :', refUnits.toString());
        console.log('    ref  claimed (2dec):', formatAmount(to2dec(claimedRef18), 2));
        console.log('    ref  current (2dec) :', formatAmount(to2dec(refCurrent18), 2));
        console.log('    ref total (2dec) :', formatAmount(to2dec(claimedRef18 + refCurrent18), 2));
        console.log('    ref   last  (2dec) :', formatAmount(to2dec(refY18),     2));
    }

    async function setNextBlockTimestamp(ts) {
        await ethers.provider.send('evm_setNextBlockTimestamp', [ts]);
        await ethers.provider.send('evm_mine', []);
    }

    // env의 PK_WALLET_A/PK_WALLET_B를 우선 사용하여 해당 주소용 signer 반환
    async function getEnvOrLocalSigner(targetAddr) {
        const want = targetAddr.toLowerCase();
        const pkA = process.env.PK_WALLET_A;
        const pkB = process.env.PK_WALLET_B;
        if (pkA) {
            const w = new ethers.Wallet(pkA, ethers.provider);
            if (w.address.toLowerCase() === want) return w;
        }
        if (pkB) {
            const w = new ethers.Wallet(pkB, ethers.provider);
            if (w.address.toLowerCase() === want) return w;
        }
        const signers = await ethers.getSigners();
        const found = signers.find((s) => s.address.toLowerCase() === want);
        return found || signers[0];
    }

    // 테스트 네트워크에서 EOA에 가스가 부족하면 트랜잭션이 추정 실패하므로 보충
    async function ensureEthBalance(address, minWei = ethers.parseEther('1')) {
        const bal = await ethers.provider.getBalance(address);
        if (bal >= minWei) return;
        const [funder] = await ethers.getSigners();
        await funder.sendTransaction({ to: address, value: minWei - bal + ethers.parseEther('0.1') });
    }

    // 구매/전송을 단일 타임라인으로 정렬해 백필 (effDay 역전 방지)
    async function backfillHistoryUntil(vesting, targetTime) {
        // 1) 레퍼럴 코드 선등록
        const urows = parseUsersCsv();
        if (urows.length) {
            const users = urows.map((r) => r.wallet);
            const codes = urows.map((r) => r.code);
            await vesting.connect(owner).setReferralCodesBulk(users, codes, true);
        }

        // 2) 구매/전송 CSV를 targetTime 이전만 필터링 후 타임라인 병합 정렬
        const events = [];
        const prows = parsePurchasesCsv();
        for (let i = 0; i < prows.length; i++) {
            const r = prows[i];
            if (r.purchaseTs < BigInt(targetTime)) {
                events.push({ kind: 'p', at: Number(r.purchaseTs), r });
            }
        }
        const srows = parseSendboxCsv();
        for (let i = 0; i < srows.length; i++) {
            const t = srows[i];
            if (t.transferTs < BigInt(targetTime)) {
                events.push({ kind: 's', at: Number(t.transferTs), t });
            }
        }
        events.sort((a, b) => (a.at === b.at ? (a.kind === 'p' ? -1 : 1) : a.at - b.at));

        // 3) 순차 백필 (단건 벌크 형태) — 구매 후 전송 순 유지
        for (let i = 0; i < events.length; i++) {
            const ev = events[i];
            if (ev.kind === 'p') {
                const r = ev.r;
                const batch = [{
                    buyer: r.wallet,
                    refCodeStr: r.ref,
                    boxCount: r.amount,
                    purchaseTs: r.purchaseTs,
                    paidUnits: r.paidUnits,
                }];
                await vesting.connect(owner).backfillPurchaseBulkAt(batch);
            } else {
                const t = ev.t;
                const items = [{ from: t.from, to: t.to, boxCount: t.amount, transferTs: t.transferTs }];
                await vesting.connect(owner).backfillSendBoxBulkAt(items);
            }
        }
    }

    // fromTs(포함) ~ toTs(미포함) 구간의 이벤트만 백필
    async function backfillHistoryBetween(vesting, fromTs, toTs) {
        // 레퍼럴 선등록(아이디empotent, overwrite=true)
        const urows = parseUsersCsv();
        if (urows.length) {
            const users = urows.map((r) => r.wallet);
            const codes = urows.map((r) => r.code);
            await vesting.connect(owner).setReferralCodesBulk(users, codes, true);
        }

        const events = [];
        const prows = parsePurchasesCsv();
        for (let i = 0; i < prows.length; i++) {
            const r = prows[i];
            const ts = Number(r.purchaseTs);
            if (ts >= fromTs && ts < toTs) {
                events.push({ kind: 'p', at: ts, r });
            }
        }
        const srows = parseSendboxCsv();
        for (let i = 0; i < srows.length; i++) {
            const t = srows[i];
            const ts = Number(t.transferTs);
            if (ts >= fromTs && ts < toTs) {
                events.push({ kind: 's', at: ts, t });
            }
        }
        events.sort((a, b) => (a.at === b.at ? (a.kind === 'p' ? -1 : 1) : a.at - b.at));

        for (let i = 0; i < events.length; i++) {
            const ev = events[i];
            if (ev.kind === 'p') {
                const r = ev.r;
                const batch = [{
                    buyer: r.wallet,
                    refCodeStr: r.ref,
                    boxCount: r.amount,
                    purchaseTs: r.purchaseTs,
                    paidUnits: r.paidUnits,
                }];
                await vesting.connect(owner).backfillPurchaseBulkAt(batch);
            } else {
                const t = ev.t;
                const items = [{ from: t.from, to: t.to, boxCount: t.amount, transferTs: t.transferTs }];
                await vesting.connect(owner).backfillSendBoxBulkAt(items);
            }
        }
    }

    async function syncWeeklyUntil(vesting, VEST_START, tsTarget) {
        const DAY = 86400;
        const targetDay = Math.floor((tsTarget - Number(VEST_START)) / DAY);
        const lastSynced = Number(await vesting.lastSyncedDay());
        let delta = Math.max(0, targetDay - lastSynced);
        while (delta >= 7) {
            await vesting.syncLimitDay(7);
            delta -= 7;
        }
        // 남은 일수가 있더라도, 현재 블록 타임스탬프 기준으로 완전한 하루가 없다면
        // 컨트랙트가 "nothing to sync"로 리버트하므로 조건 검증 후 호출
        if (delta > 0) {
            const nextSyncTs = Number(await vesting.nextSyncTs());
            if (nextSyncTs + DAY <= tsTarget) {
                await vesting.syncLimitDay(delta);
            }
        }
    }

    // -------------------------------------------------------------------------
    // 배포 및 스케줄 초기화 + vestingToken 설정/예치
    // -------------------------------------------------------------------------
    beforeEach(async function () {
        // 체인 초기화 및 기준 시각으로 세팅
        await ethers.provider.send('hardhat_reset', []);
        const NOW_TS = Math.floor(Date.now() / 1000);
        await setNextBlockTimestamp(NOW_TS);

        [owner] = await ethers.getSigners();

        const Fwd = await ethers.getContractFactory('WhitelistForwarder', owner);
        forwarder = await Fwd.deploy();
        await forwarder.waitForDeployment();

        const Stable = await ethers.getContractFactory('StableCoin', owner);
        stableCoin = await Stable.deploy();
        await stableCoin.waitForDeployment();

        const TV = await ethers.getContractFactory('TokenVesting', owner);
        vesting = await TV.deploy(
            await forwarder.getAddress(),
            await stableCoin.getAddress(),
            VEST_START
        );
        await vesting.waitForDeployment();
        await vesting.initializeSchedule(VEST_ENDS, BUYER_TOTALS, REF_TOTALS);

        const Token = await ethers.getContractFactory('Token', owner);
        token = await Token.deploy();
        await token.waitForDeployment();
        await vesting.setVestingToken(await token.getAddress());

        const sumArray = (arr) => arr.reduce((a, b) => a + BigInt(b), 0n);
        const TOTAL_FUND = sumArray(BUYER_TOTALS) + sumArray(REF_TOTALS);
        await token.transfer(await vesting.getAddress(), TOTAL_FUND);
    });

    // -------------------------------------------------------------------------
    // it 블록들 — 요청된 4개 시각
    // -------------------------------------------------------------------------
    it('2025-06-03 01:00:00 기준', async function () {
        const TS = Math.floor(Date.parse('2025-06-03T01:00:00Z') / 1000);
        await backfillHistoryUntil(vesting, TS);
        await printFourMetricsAt(vesting, WALLET_X, TS);
        await printFourMetricsAt(vesting, WALLET_A, TS);
        await printFourMetricsAt(vesting, WALLET_B, TS);
        console.log('[TOTAL-BOX-PURCHASED]', (await vesting.getTotalBoxPurchased()).toString());
    });

    it('2026-06-01 01:00:00 기준', async function () {
        const TS = Math.floor(Date.parse('2026-06-01T01:00:00Z') / 1000);
        await setNextBlockTimestamp(TS);
        await backfillHistoryUntil(vesting, TS);
        await syncWeeklyUntil(vesting, VEST_START, TS);
        await printFourMetricsAt(vesting, WALLET_X, TS);
        await printFourMetricsAt(vesting, WALLET_A, TS);
        await printFourMetricsAt(vesting, WALLET_B, TS);
        console.log('[TOTAL-BOX-PURCHASED]', (await vesting.getTotalBoxPurchased()).toString());
    });

    it('2026-06-01 13:00:00 기준 (12:00 A/B 클레임 후)', async function () {
        const CLAIM_TS = Math.floor(Date.parse('2026-06-01T12:00:00Z') / 1000);
        const TARGET_TS = Math.floor(Date.parse('2026-06-01T13:00:00Z') / 1000);

        // 1) 12:00까지 백필 + sync 후 A/B 클레임
        await setNextBlockTimestamp(CLAIM_TS);
        await backfillHistoryUntil(vesting, CLAIM_TS);
        await syncWeeklyUntil(vesting, VEST_START, CLAIM_TS);

        const signerA = await getEnvOrLocalSigner(WALLET_A);
        const signerB = await getEnvOrLocalSigner(WALLET_B);
        await ensureEthBalance(await signerA.getAddress());
        await ensureEthBalance(await signerB.getAddress());
        const balA0 = await token.balanceOf(WALLET_A);
        const balB0 = await token.balanceOf(WALLET_B);
        await vesting.connect(signerA).claimPurchaseReward();
        await vesting.connect(signerB).claimPurchaseReward();
        const balA1 = await token.balanceOf(WALLET_A);
        const balB1 = await token.balanceOf(WALLET_B);
        const recA = balA1 - balA0;
        const recB = balB1 - balB0;
        const atA = await vesting.previewBuyerClaimableAt(WALLET_A, CLAIM_TS);
        const atB = await vesting.previewBuyerClaimableAt(WALLET_B, CLAIM_TS);
        console.log('[CLAIM-RECEIVED 2026-06-01 12:00:00] A=', formatAmount(to2dec(recA), 2), 'B=', formatAmount(to2dec(recB), 2));
        console.log('[CLAIM+VESTING@CLAIM_TS] A=', formatAmount(to2dec(recA + atA), 2), 'B=', formatAmount(to2dec(recB + atB), 2));

        // 2) 13:00까지 추가 백필 + sync 후 지표 출력 (클레임분 반영)
        await setNextBlockTimestamp(TARGET_TS);
        await backfillHistoryBetween(vesting, CLAIM_TS, TARGET_TS);
        await syncWeeklyUntil(vesting, VEST_START, TARGET_TS);
        await printFourMetricsAt(vesting, WALLET_X, TARGET_TS, 0n, 0n);
        await printFourMetricsAt(vesting, WALLET_A, TARGET_TS, recA, 0n);
        await printFourMetricsAt(vesting, WALLET_B, TARGET_TS, recB, 0n);
        console.log('[TOTAL-BOX-PURCHASED]', (await vesting.getTotalBoxPurchased()).toString());
    });

    it('2026-06-02 01:00:00 기준 (전일 12:00 A/B 클레임 이후)', async function () {
        const CLAIM_TS = Math.floor(Date.parse('2026-06-01T12:00:00Z') / 1000);
        const TARGET_TS = Math.floor(Date.parse('2026-06-02T01:00:00Z') / 1000);

        // 1) 12:00까지 백필 + sync 후 A/B 클레임
        await setNextBlockTimestamp(CLAIM_TS);
        await backfillHistoryUntil(vesting, CLAIM_TS);
        await syncWeeklyUntil(vesting, VEST_START, CLAIM_TS);

        const signerA = await getEnvOrLocalSigner(WALLET_A);
        const signerB = await getEnvOrLocalSigner(WALLET_B);
        await ensureEthBalance(await signerA.getAddress());
        await ensureEthBalance(await signerB.getAddress());
        const balA0 = await token.balanceOf(WALLET_A);
        const balB0 = await token.balanceOf(WALLET_B);
        await vesting.connect(signerA).claimPurchaseReward();
        await vesting.connect(signerB).claimPurchaseReward();
        const balA1 = await token.balanceOf(WALLET_A);
        const balB1 = await token.balanceOf(WALLET_B);
        const recA = balA1 - balA0;
        const recB = balB1 - balB0;

        // 2) 다음날 01:00까지 추가 백필 + sync 후 지표 출력 (클레임분 반영)
        await setNextBlockTimestamp(TARGET_TS);
        await backfillHistoryBetween(vesting, CLAIM_TS, TARGET_TS);
        await syncWeeklyUntil(vesting, VEST_START, TARGET_TS);
        await printFourMetricsAt(vesting, WALLET_X, TARGET_TS, 0n, 0n);
        await printFourMetricsAt(vesting, WALLET_A, TARGET_TS, recA, 0n);
        await printFourMetricsAt(vesting, WALLET_B, TARGET_TS, recB, 0n);
        console.log('[TOTAL-BOX-PURCHASED]', (await vesting.getTotalBoxPurchased()).toString());
    });
});



