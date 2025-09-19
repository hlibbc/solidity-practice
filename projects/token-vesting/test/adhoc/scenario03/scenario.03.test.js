/* eslint-disable no-console */
/**
 * @fileoverview
 *  scenario.03 — 지정된 스케줄/CSV로 백필 후, 여러 목표 시점 기준의 베스팅 지표 출력
 * @description
 *  - beforeEach()에서 컨트랙트 배포 및 스케줄 초기화 수행
 *  - 2025-06-03/04/05 01:00은 과거 시점이므로 scenario.02와 동일 패턴(체인시간 이동 없이 미리보기)으로 처리
 *  - 2026-06-01/02 01:00은 현재 블록시간을 A로 저장 후 target으로 이동 → CSV 백필(해당 시각 이전분만) → 7일 단위 동기화
 */

const fs = require('fs');
const path = require('path');
const { ethers } = require('hardhat');
const { expect } = require('chai');

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

// 대상 지갑들 (요청된 3개)
const WALLET_X = ethers.getAddress('0x5989B53ee3E58a5435eefa44Bebfe6fdbb27Ba29');
const WALLET_A = ethers.getAddress('0x70997970C51812dc3A010C7d01b50e0d17dc79C8');
const WALLET_B = ethers.getAddress('0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC');

describe('scenario.03 — 여러 시점 기준 베스팅 지표 출력', function () {
    let owner, forwarder, stableCoin, vesting, token;

    // -------------------------------------------------------------------------
    // 유틸: CSV/포맷/시각
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

    async function printFourMetricsAt(vesting, user, ts) {
        const buyTotal18 = await vesting.previewBuyerClaimableAt(user, ts);
        const buyY18     = await vesting.previewBuyerEarnedYesterday(user);
        const refTotal18 = await vesting.previewReferrerClaimableAt(user, ts);
        const refY18     = await vesting.previewReferrerEarnedYesterday(user);

        console.log(`[METRICS] ${user} @ ${ts}`);
        console.log('    buyer total (18dec):', formatAmount(buyTotal18, 18));
        console.log('    buyer last  (18dec):', formatAmount(buyY18,     18));
        console.log('    buyer total (2dec) :', formatAmount(to2dec(buyTotal18), 2));
        console.log('    buyer last  (2dec) :', formatAmount(to2dec(buyY18),     2));
        console.log('    ref   total (18dec):', formatAmount(refTotal18, 18));
        console.log('    ref   last  (18dec):', formatAmount(refY18,     18));
        console.log('    ref   total (2dec) :', formatAmount(to2dec(refTotal18), 2));
        console.log('    ref   last  (2dec) :', formatAmount(to2dec(refY18),     2));
    }

    async function setNextBlockTimestamp(ts) {
        await ethers.provider.send('evm_setNextBlockTimestamp', [ts]);
        await ethers.provider.send('evm_mine', []);
    }

    // -------------------------------------------------------------------------
    // 배포 및 스케줄 초기화
    // -------------------------------------------------------------------------
    beforeEach(async function () {
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

        // vestingToken 배포/설정 및 총량 예치 (scripts/setVestingToken.js 참조)
        const Token = await ethers.getContractFactory('Token', owner);
        token = await Token.deploy();
        await token.waitForDeployment();
        await vesting.setVestingToken(await token.getAddress());

        const sumArray = (arr) => arr.reduce((a, b) => a + BigInt(b), 0n);
        const TOTAL_FUND = sumArray(BUYER_TOTALS) + sumArray(REF_TOTALS);
        await token.transfer(await vesting.getAddress(), TOTAL_FUND);
    });

    // -------------------------------------------------------------------------
    // 과거 시점(체인 시간 이동 없음) — scenario.02와 동일 패턴
    // -------------------------------------------------------------------------
    it('2025-06-03 01:00 기준', async function () {
        const TS = Math.floor(Date.parse('2025-06-03T01:00:00Z') / 1000);

        const urows = parseUsersCsv();
        if (urows.length) {
            const users = urows.map((r) => r.wallet);
            const codes = urows.map((r) => r.code);
            await vesting.connect(owner).setReferralCodesBulk(users, codes, true);
        }

        const prows = parsePurchasesCsv();
        for (let i = 0; i < prows.length; i++) {
            const r = prows[i];
            if (r.purchaseTs < BigInt(TS)) {
                const batch = [{
                    buyer: r.wallet,
                    refCodeStr: r.ref,
                    boxCount: r.amount,
                    purchaseTs: r.purchaseTs,
                    paidUnits: r.paidUnits,
                }];
                await vesting.connect(owner).backfillPurchaseBulkAt(batch);
            }
        }

        const srows = parseSendboxCsv();
        for (let i = 0; i < srows.length; i++) {
            const t = srows[i];
            if (t.transferTs < BigInt(TS)) {
                const items = [{ from: t.from, to: t.to, boxCount: t.amount, transferTs: t.transferTs }];
                await vesting.connect(owner).backfillSendBoxBulkAt(items);
            }
        }

        await printFourMetricsAt(vesting, WALLET_X, TS);
        await printFourMetricsAt(vesting, WALLET_A, TS);
        await printFourMetricsAt(vesting, WALLET_B, TS);
    });

    it('2025-06-04 01:00 기준', async function () {
        const TS = Math.floor(Date.parse('2025-06-04T01:00:00Z') / 1000);

        const urows = parseUsersCsv();
        if (urows.length) {
            const users = urows.map((r) => r.wallet);
            const codes = urows.map((r) => r.code);
            await vesting.connect(owner).setReferralCodesBulk(users, codes, true);
        }

        const prows = parsePurchasesCsv();
        for (let i = 0; i < prows.length; i++) {
            const r = prows[i];
            if (r.purchaseTs < BigInt(TS)) {
                const batch = [{
                    buyer: r.wallet,
                    refCodeStr: r.ref,
                    boxCount: r.amount,
                    purchaseTs: r.purchaseTs,
                    paidUnits: r.paidUnits,
                }];
                await vesting.connect(owner).backfillPurchaseBulkAt(batch);
            }
        }

        const srows = parseSendboxCsv();
        for (let i = 0; i < srows.length; i++) {
            const t = srows[i];
            if (t.transferTs < BigInt(TS)) {
                const items = [{ from: t.from, to: t.to, boxCount: t.amount, transferTs: t.transferTs }];
                await vesting.connect(owner).backfillSendBoxBulkAt(items);
            }
        }

        await printFourMetricsAt(vesting, WALLET_X, TS);
        await printFourMetricsAt(vesting, WALLET_A, TS);
        await printFourMetricsAt(vesting, WALLET_B, TS);
    });

    it('2025-06-05 01:00 기준', async function () {
        const TS = Math.floor(Date.parse('2025-06-05T01:00:00Z') / 1000);

        const urows = parseUsersCsv();
        if (urows.length) {
            const users = urows.map((r) => r.wallet);
            const codes = urows.map((r) => r.code);
            await vesting.connect(owner).setReferralCodesBulk(users, codes, true);
        }

        const prows = parsePurchasesCsv();
        for (let i = 0; i < prows.length; i++) {
            const r = prows[i];
            if (r.purchaseTs < BigInt(TS)) {
                const batch = [{
                    buyer: r.wallet,
                    refCodeStr: r.ref,
                    boxCount: r.amount,
                    purchaseTs: r.purchaseTs,
                    paidUnits: r.paidUnits,
                }];
                await vesting.connect(owner).backfillPurchaseBulkAt(batch);
            }
        }

        const srows = parseSendboxCsv();
        for (let i = 0; i < srows.length; i++) {
            const t = srows[i];
            if (t.transferTs < BigInt(TS)) {
                const items = [{ from: t.from, to: t.to, boxCount: t.amount, transferTs: t.transferTs }];
                await vesting.connect(owner).backfillSendBoxBulkAt(items);
            }
        }

        await printFourMetricsAt(vesting, WALLET_X, TS);
        await printFourMetricsAt(vesting, WALLET_A, TS);
        await printFourMetricsAt(vesting, WALLET_B, TS);
    });

    // -------------------------------------------------------------------------
    // 미래 시점(체인 시간 이동 + 7일 단위 sync)
    // -------------------------------------------------------------------------
    it('2026-06-01 01:00 기준', async function () {
        const A = (await ethers.provider.getBlock('latest')).timestamp;
        const targetTime = Math.floor(Date.parse('2026-06-01T01:00:00Z') / 1000);
        await setNextBlockTimestamp(targetTime);

        const urows = parseUsersCsv();
        if (urows.length) {
            const users = urows.map((r) => r.wallet);
            const codes = urows.map((r) => r.code);
            await vesting.connect(owner).setReferralCodesBulk(users, codes, true);
        }

        const prows = parsePurchasesCsv();
        for (let i = 0; i < prows.length; i++) {
            const r = prows[i];
            if (r.purchaseTs < BigInt(targetTime)) {
                const batch = [{
                    buyer: r.wallet,
                    refCodeStr: r.ref,
                    boxCount: r.amount,
                    purchaseTs: r.purchaseTs,
                    paidUnits: r.paidUnits,
                }];
                await vesting.connect(owner).backfillPurchaseBulkAt(batch);
            }
        }

        const srows = parseSendboxCsv();
        for (let i = 0; i < srows.length; i++) {
            const t = srows[i];
            if (t.transferTs < BigInt(targetTime)) {
                const items = [{ from: t.from, to: t.to, boxCount: t.amount, transferTs: t.transferTs }];
                await vesting.connect(owner).backfillSendBoxBulkAt(items);
            }
        }

        const days = Math.max(0, Math.floor((targetTime - A) / 86400));
        const loops = Math.floor(days / 7);
        for (let i = 0; i < loops; i++) {
            await vesting.syncLimitDay(7);
        }

        await printFourMetricsAt(vesting, WALLET_X, targetTime);
        await printFourMetricsAt(vesting, WALLET_A, targetTime);
        await printFourMetricsAt(vesting, WALLET_B, targetTime);
    });

    it('2026-06-02 01:00 기준', async function () {
        const A = (await ethers.provider.getBlock('latest')).timestamp;
        const targetTime = Math.floor(Date.parse('2026-06-02T01:00:00Z') / 1000);
        await setNextBlockTimestamp(targetTime);

        const urows = parseUsersCsv();
        if (urows.length) {
            const users = urows.map((r) => r.wallet);
            const codes = urows.map((r) => r.code);
            await vesting.connect(owner).setReferralCodesBulk(users, codes, true);
        }

        const prows = parsePurchasesCsv();
        for (let i = 0; i < prows.length; i++) {
            const r = prows[i];
            if (r.purchaseTs < BigInt(targetTime)) {
                const batch = [{
                    buyer: r.wallet,
                    refCodeStr: r.ref,
                    boxCount: r.amount,
                    purchaseTs: r.purchaseTs,
                    paidUnits: r.paidUnits,
                }];
                await vesting.connect(owner).backfillPurchaseBulkAt(batch);
            }
        }

        const srows = parseSendboxCsv();
        for (let i = 0; i < srows.length; i++) {
            const t = srows[i];
            if (t.transferTs < BigInt(targetTime)) {
                const items = [{ from: t.from, to: t.to, boxCount: t.amount, transferTs: t.transferTs }];
                await vesting.connect(owner).backfillSendBoxBulkAt(items);
            }
        }

        const days = Math.max(0, Math.floor((targetTime - A) / 86400));
        const loops = Math.floor(days / 7);
        for (let i = 0; i < loops; i++) {
            await vesting.syncLimitDay(7);
        }

        await printFourMetricsAt(vesting, WALLET_X, targetTime);
        await printFourMetricsAt(vesting, WALLET_A, targetTime);
        await printFourMetricsAt(vesting, WALLET_B, targetTime);
    });

    it('claim 흐름: 2025-06-03 12:00 1회, 2026-06-01 12:00 2회', async function () {
        // 기준 시각
        const T0_0000 = Math.floor(Date.parse('2025-06-03T00:00:00Z') / 1000);
        const T0_1200 = Math.floor(Date.parse('2025-06-03T12:00:00Z') / 1000);
        const T1_0000 = Math.floor(Date.parse('2026-06-01T00:00:00Z') / 1000);
        const T1_1200 = Math.floor(Date.parse('2026-06-01T12:00:00Z') / 1000);

        // 1) 2025-06-03 00:00 이전 액션 백필 (referral → purchase/sendbox)
        const urows1 = parseUsersCsv();
        if (urows1.length) {
            const users = urows1.map((r) => r.wallet);
            const codes = urows1.map((r) => r.code);
            await vesting.connect(owner).setReferralCodesBulk(users, codes, true);
        }

        const prows1 = parsePurchasesCsv();
        for (let i = 0; i < prows1.length; i++) {
            const r = prows1[i];
            if (r.purchaseTs < BigInt(T0_0000)) {
                const batch = [{
                    buyer: r.wallet,
                    refCodeStr: r.ref,
                    boxCount: r.amount,
                    purchaseTs: r.purchaseTs,
                    paidUnits: r.paidUnits,
                }];
                await vesting.connect(owner).backfillPurchaseBulkAt(batch);
            }
        }
        const srows1 = parseSendboxCsv();
        for (let i = 0; i < srows1.length; i++) {
            const t = srows1[i];
            if (t.transferTs < BigInt(T0_0000)) {
                const items = [{ from: t.from, to: t.to, boxCount: t.amount, transferTs: t.transferTs }];
                await vesting.connect(owner).backfillSendBoxBulkAt(items);
            }
        }

        // 2) syncLimitDay(1) — 2025-06-02 하루 확정 (체인시각은 2025-06-03 12:00로 이동 후 실행)
        await setNextBlockTimestamp(T0_1200);
        await vesting.syncLimitDay(1);

        // 3) 2025-06-03 12:00 에서 A의 구매자 보상 클레임 (≈ 15065.57)
        const signers = await ethers.getSigners();
        const signerA = signers.find((s) => s.address.toLowerCase() === WALLET_A.toLowerCase());
        const balA0 = await token.balanceOf(WALLET_A);
        const tx1 = await vesting.connect(signerA).claimPurchaseReward();
        await tx1.wait();
        const balA1 = await token.balanceOf(WALLET_A);
        const claimedA1 = balA1 - balA0;

        const toFixed2From18 = (bn) => {
            const s = BigInt(bn).toString().padStart(19, '0');
            const intPart = s.slice(0, -18) || '0';
            const frac2 = s.slice(-18, -16).padStart(2, '0');
            return `${intPart}.${frac2}`;
        };
        const a1Str = toFixed2From18(claimedA1);
        console.log(`[CLAIM-2025-06-03 12:00] A claimed: ${a1Str}`);
        expect(a1Str).to.equal('15065.57');

        // 4) 체인 시간을 2026-06-01 12:00으로 이동
        await setNextBlockTimestamp(T1_1200);

        // 5) 2026-06-01 00:00 이전 액션들 등록 (단, 중복 방지 위해 [T0_0000, T1_0000)만)
        const urows2 = parseUsersCsv();
        if (urows2.length) {
            const users = urows2.map((r) => r.wallet);
            const codes = urows2.map((r) => r.code);
            await vesting.connect(owner).setReferralCodesBulk(users, codes, true);
        }
        const prows2 = parsePurchasesCsv();
        for (let i = 0; i < prows2.length; i++) {
            const r = prows2[i];
            if (r.purchaseTs >= BigInt(T0_0000) && r.purchaseTs < BigInt(T1_0000)) {
                const batch = [{
                    buyer: r.wallet,
                    refCodeStr: r.ref,
                    boxCount: r.amount,
                    purchaseTs: r.purchaseTs,
                    paidUnits: r.paidUnits,
                }];
                await vesting.connect(owner).backfillPurchaseBulkAt(batch);
            }
        }
        const srows2 = parseSendboxCsv();
        for (let i = 0; i < srows2.length; i++) {
            const t = srows2[i];
            if (t.transferTs >= BigInt(T0_0000) && t.transferTs < BigInt(T1_0000)) {
                const items = [{ from: t.from, to: t.to, boxCount: t.amount, transferTs: t.transferTs }];
                await vesting.connect(owner).backfillSendBoxBulkAt(items);
            }
        }

        // 6) 7일 단위로 syncLimitDay(7) 수행
        const A = T0_1200; // 직전 기준 시각
        const days = Math.max(0, Math.floor((T1_1200 - A) / 86400));
        const loops = Math.floor(days / 7);
        for (let i = 0; i < loops; i++) {
            await vesting.syncLimitDay(7);
        }

        // 7) 2026-06-01 12:00에 A, B 순서로 구매자 보상 클레임
        const balA2 = await token.balanceOf(WALLET_A);
        const tx2 = await vesting.connect(signerA).claimPurchaseReward();
        await tx2.wait();
        const balA3 = await token.balanceOf(WALLET_A);
        const claimedA2 = balA3 - balA2; // 두 번째 청구분
        const a2Str = toFixed2From18(claimedA2);
        console.log(`[CLAIM-2026-06-01 12:00] A claimed: ${a2Str}`);
        expect(a2Str).to.equal('5468805.31');

        const signerB = signers.find((s) => s.address.toLowerCase() === WALLET_B.toLowerCase());
        const balB0 = await token.balanceOf(WALLET_B);
        const tx3 = await vesting.connect(signerB).claimPurchaseReward();
        await tx3.wait();
        const balB1 = await token.balanceOf(WALLET_B);
        const claimedB = balB1 - balB0;
        const bStr = toFixed2From18(claimedB);
        console.log(`[CLAIM-2026-06-01 12:00] B claimed: ${bStr}`);
        expect(bStr).to.equal('15065.57');
    });
});


