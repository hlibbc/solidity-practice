/* eslint-disable no-console */
/**
 * @fileoverview
 *  scenario.01 — 지정된 스케줄/CSV로 백필 후, 시점별 베스팅 누적/일일 값을 검증
 * @description
 *  - before()에서 컨트랙트 배포 및 스케줄/CSV 백필을 수행
 *  - it()에서 시간을 2025-06-03 13:00로 맞춘 뒤 sync → 각 유저의 누적/어제분을 확인
 */

const fs = require('fs');
const path = require('path');
const { ethers } = require('hardhat');

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

// 대상 지갑들
const WALLET_A = ethers.getAddress('0x70997970C51812dc3A010C7d01b50e0d17dc79C8');
const WALLET_B = ethers.getAddress('0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC');

describe('scenario.01 — CSV 백필 후 시점별 베스팅 값 확인', function () {
    let owner, forwarder, stableCoin, vesting;

    /**
     * @notice CSV 파일을 읽어 라인 배열로 반환
     * @dev 공백 라인은 제거하고, 각 라인은 trim 처리
     * @param {string} p 읽을 CSV 파일 경로(절대/상대)
     * @returns {string[]} 라인 배열(헤더 포함, 공백 라인 제거)
     */
    function readCsv(p) {
        const t = fs.readFileSync(p, 'utf8');
        return t.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    }

    /**
     * @notice user.csv 파싱 (wallet_address, referral_code)
     * @dev 헤더를 기준으로 컬럼 인덱스를 탐지하여 안전 파싱
     * @returns {Array<{wallet:string, code:string}>} 파싱된 유저 배열
     */
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

    /**
     * @notice purchase_history.csv 파싱
     * @dev header: wallet_address, referral, amount, avg_price, updated_at
     * @returns {Array<{wallet:string, ref:string, amount:bigint, purchaseTs:bigint, paidUnits:bigint}>}
     */
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
            // 시간 파싱(UTC 가정)
            const ms = Date.parse(timeStr.replace(' ', 'T') + 'Z');
            const purchaseTs = BigInt(Math.floor(ms / 1000));
            // USDT 6dec 금액
            const price6 = BigInt(String(priceStr).split('.')[0] || '0') * 10n ** 6n +
                BigInt(((String(priceStr).split('.')[1] || '') + '000000').slice(0, 6));
            const paidUnits = amount * price6;
            out.push({ wallet, ref, amount, purchaseTs, paidUnits });
        }
        // 시간 오름차순 정렬 권장
        out.sort((a, b) => Number(a.purchaseTs - b.purchaseTs));
        return out;
    }

    /**
     * @notice 10의 거듭제곱
     * @param {number|bigint} n 지수
     * @returns {bigint} 10^n
     */
    const pow10 = (n) => TEN ** BigInt(n);
    const TEN = 10n;

    /**
     * @notice bigint 금액을 소수부 포함 문자열로 포맷
     * @param {bigint} bn 정수 기반 금액
     * @param {number} decimals 소수 자리수
     * @returns {string} 예: 123.450000
     */
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

    /**
     * @notice 18dec 값을 소수 2자리 표현치로 근사 변환(디스플레이용)
     * @param {bigint} x18 18 decimals 값
     * @returns {bigint} 소수 2자리 기준 값(반올림 없음)
     */
    const to2dec = (x18) => BigInt(x18) / pow10(16);
    
    /**
     * 
     * @param {*} vesting 
     */
    async function printTotalBoxPurchased(vesting) {
        const totalBoxes = await vesting.getTotalBoxPurchased();

        console.log('\n[TOTAL-BOX PURCHASED]');
        console.log('    total boxes sold:', totalBoxes.toString());
    }

    async function syncWeeklyUntil(vesting, VEST_START, tsTarget) {
        const targetDay = Math.floor((tsTarget - Number(VEST_START)) / 86400); // tsTarget이 속한 day index
        const lastSynced = Number(await vesting.lastSyncedDay());
        let delta = Math.max(0, targetDay - lastSynced);
        while (delta >= 7) {
            await vesting.syncLimitDay(7);
            delta -= 7;
        }
        // if (delta > 0) {
        //     await vesting.syncLimitDay(delta);
        // }
    }
    
    async function printFourMetricsAt(vesting, user, ts) {
        const buyTotal18 = await vesting.previewBuyerClaimableAt(user, ts);     // 18dec
        const buyY18     = await vesting.previewBuyerEarnedYesterday(user);     // 18dec (소수 6자리까지만 유효)
        const refTotal18 = await vesting.previewReferrerClaimableAt(user, ts);  // 18dec
        const refY18     = await vesting.previewReferrerEarnedYesterday(user);  // 18dec (소수 6자리까지만 유효)

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

    

    /**
     * @notice 지정 시각(ts) 기준 구매자 누적/최근 하루치(전일) 출력
     * @dev 필요 시 syncLimitDay로 targetDay-1까지 확정
     * @param {import('ethers').Contract} vesting TokenVesting 컨트랙트
     * @param {string} user 조회 대상 주소
     * @param {bigint} VEST_START 베스팅 시작 epoch(sec)
     * @param {number} ts 기준 시각 epoch(sec)
     */
    async function printBuyerAtTs(vesting, user, VEST_START, ts) {
        const targetDay = Math.floor((ts - Number(VEST_START)) / 86400); // day index at ts
        const lastSynced = Number(await vesting.lastSyncedDay());
        const needFinal = Math.max(0, targetDay - lastSynced);
        if (needFinal > 0) {
            await vesting.syncLimitDay(needFinal); // day 0..(targetDay-1) 확정
        }

        const total18 = await vesting.previewBuyerClaimableAt(user, ts);

        let last18 = 0n;
        if (targetDay > 0) {
            const yIndex = BigInt(targetDay - 1);
            const per    = await vesting.rewardPerBox(yIndex);          // 18dec
            const bal    = await vesting.buyerBoxesAtDay(user, yIndex); // 정수
            last18 = per * bal; // 18dec
        }

        console.log(`[BUYER] @ ${ts}`);
        console.log('    total(18dec):', formatAmount(total18, 18));
        console.log('    last (18dec):', formatAmount(last18,  18));
        console.log('    total(2dec) :', formatAmount(to2dec(total18), 2));
        console.log('    last (2dec) :', formatAmount(to2dec(last18),  2));
    }

    /**
     * @notice 지정 시각(ts) 기준 추천인 누적/최근 하루치(전일) 출력
     * @dev 필요 시 syncLimitDay로 targetDay-1까지 확정
     * @param {import('ethers').Contract} vesting TokenVesting 컨트랙트
     * @param {string} user 조회 대상 주소
     * @param {bigint} VEST_START 베스팅 시작 epoch(sec)
     * @param {number} ts 기준 시각 epoch(sec)
     */
    async function printRefAtTs(vesting, user, VEST_START, ts) {
        const targetDay = Math.floor((ts - Number(VEST_START)) / 86400);
        const lastSynced = Number(await vesting.lastSyncedDay());
        const needFinal = Math.max(0, targetDay - lastSynced);
        if (needFinal > 0) {
            await vesting.syncLimitDay(needFinal);
        }

        const total18 = await vesting.previewReferrerClaimableAt(user, ts);

        let last18 = 0n;
        if (targetDay > 0) {
            const yIndex = BigInt(targetDay - 1);
            const per    = await vesting.rewardPerReferral(yIndex);         // 18dec
            const units  = await vesting.referralUnitsAtDay(user, yIndex);  // 정수
            last18 = per * units; // 18dec
        }

        console.log(`[REF] @ ${ts}`);
        console.log('    total(18dec):', formatAmount(total18, 18));
        console.log('    last (18dec):', formatAmount(last18,   18));
        console.log('    total(2dec) :', formatAmount(to2dec(total18), 2));
        console.log('    last (2dec) :', formatAmount(to2dec(last18),  2));
    }

    /**
     * 
     * @param {*} ts 
     */
    async function setNextBlockTimestamp(ts) {
        // ts: number (epoch sec)
        await ethers.provider.send('evm_setNextBlockTimestamp', [ts]);
        await ethers.provider.send('evm_mine', []);
    }

    // -------------------------------------------------------------------------
    // 배포 및 백필
    // -------------------------------------------------------------------------
    before(async function () {
        // 1) 배포 (vestingFixture를 참조하되 인라인 구성)
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

        // 스케줄 초기화
        await vesting.initializeSchedule(VEST_ENDS, BUYER_TOTALS, REF_TOTALS);

        // 2) CSV: 레퍼럴 선등록 → 구매 백필(bulk)
        const urows = parseUsersCsv();
        if (urows.length) {
            const users = urows.map((r) => r.wallet);
            const codes = urows.map((r) => r.code);
            await vesting.connect(owner).setReferralCodesBulk(users, codes, true);
        }

        const prows = parsePurchasesCsv();
        if (prows.length) {
            // 10개씩 벌크 호출
            for (let i = 0; i < prows.length; i += 10) {
                const batch = prows.slice(i, i + 10).map((r) => ({
                    buyer: r.wallet,
                    refCodeStr: r.ref,
                    boxCount: r.amount,
                    purchaseTs: r.purchaseTs,
                    paidUnits: r.paidUnits,
                }));
                await vesting.connect(owner).backfillPurchaseBulkAt(batch);
            }
        }
    });

    it('[ADHOC]: 2025-06-03 13:00 기준 누적/최근 하루치 출력', async function () {
        const TS_2025_0603_1300 = 1748955600;
        console.log('\n=== [A] 0x7099..79C8 @ 2025-06-03 13:00 ===');
        await printBuyerAtTs(vesting, WALLET_A, VEST_START, TS_2025_0603_1300);
        await printRefAtTs(vesting, WALLET_A, VEST_START, TS_2025_0603_1300);

        console.log('\n=== [B] 0x3C44..93BC @ 2025-06-03 13:00 ===');
        await printBuyerAtTs(vesting, WALLET_B, VEST_START, TS_2025_0603_1300);
        await printRefAtTs(vesting, WALLET_B, VEST_START, TS_2025_0603_1300);

        await printTotalBoxPurchased(vesting);
    });
    it('[ADHOC]: 2025-06-04 13:00 기준 누적/최근 하루치 출력', async function () {
        const TS_2025_0604_1300 = 1749042000;
        console.log('\n=== [A] 0x7099..79C8 @ 2025-06-04 13:00 ===');
        await printBuyerAtTs(vesting, WALLET_A, VEST_START, TS_2025_0604_1300);
        await printRefAtTs(vesting, WALLET_A, VEST_START, TS_2025_0604_1300);

        console.log('\n=== [B] 0x3C44..93BC @ 2025-06-04 13:00 ===');
        await printBuyerAtTs(vesting, WALLET_B, VEST_START, TS_2025_0604_1300);
        await printRefAtTs(vesting, WALLET_B, VEST_START, TS_2025_0604_1300);

        await printTotalBoxPurchased(vesting);
    });
    it('[ADHOC]: 2026-06-01 13:00 기준 가격/베스팅 지표 출력', async function () {
        // 1) 현재 시각 A에서 한 번 sync
        await vesting.sync();
        const A = (await ethers.provider.getBlock('latest')).timestamp;

        // 2) 체인 시간을 미래(2026-06-01 13:00:00 UTC)로 이동
        const TS_2026_0601_1300 = Math.floor(Date.parse('2026-06-01T13:00:00Z') / 1000);
        await setNextBlockTimestamp(TS_2026_0601_1300);


        // 3) 주(7일) 단위로 syncLimitDay 진행 + 잔여 처리
        await syncWeeklyUntil(vesting, VEST_START, TS_2026_0601_1300);

        // 4) 글로벌(총 판매수/1박스 가격) 출력 — 이 시점 상태로
        await printTotalBoxPurchased(vesting);

        // 5) 두 지갑의 4가지 지표 출력 (claimable/earnedYesterday, buyer/ref)
        await printFourMetricsAt(vesting, WALLET_A, TS_2026_0601_1300);
        await printFourMetricsAt(vesting, WALLET_B, TS_2026_0601_1300);
    });
    it('[ADHOC]: 2026-06-02 13:00 기준 가격/베스팅 지표 출력', async function () {
        // 1) 현재 시각 A에서 한 번 sync
        await vesting.sync();
        const A = (await ethers.provider.getBlock('latest')).timestamp;

        // 2) 체인 시간을 미래(2026-06-02 13:00:00 UTC)로 이동
        const TS_2026_0602_1300 = Math.floor(Date.parse('2026-06-02T13:00:00Z') / 1000);
        await setNextBlockTimestamp(TS_2026_0602_1300);


        // 3) 주(7일) 단위로 syncLimitDay 진행 + 잔여 처리
        await syncWeeklyUntil(vesting, VEST_START, TS_2026_0602_1300);

        // 4) 글로벌(총 판매수/1박스 가격) 출력 — 이 시점 상태로
        await printTotalBoxPurchased(vesting);

        // 5) 두 지갑의 4가지 지표 출력 (claimable/earnedYesterday, buyer/ref)
        await printFourMetricsAt(vesting, WALLET_A, TS_2026_0602_1300);
        await printFourMetricsAt(vesting, WALLET_B, TS_2026_0602_1300);
    });

    it('[ADHOC]: 2029-06-01 13:00 기준 가격/베스팅 지표 출력', async function () {
        // 1) 현재 시각 A에서 한 번 sync
        await vesting.sync();
        const A = (await ethers.provider.getBlock('latest')).timestamp;

        // 2) 체인 시간을 미래(2029-06-01 13:00:00 UTC)로 이동
        const TS_2029_0601_1300 = Math.floor(Date.parse('2029-06-01T13:00:00Z') / 1000);
        await setNextBlockTimestamp(TS_2029_0601_1300);

        // 3) 주(7일) 단위로 syncLimitDay 진행 + 잔여 처리
        await syncWeeklyUntil(vesting, VEST_START, TS_2029_0601_1300);

        // 4) 글로벌(총 판매수/1박스 가격) 출력 — 이 시점 상태로
        await printTotalBoxPurchased(vesting);

        // 5) 두 지갑의 4가지 지표 출력 (claimable/earnedYesterday, buyer/ref)
        await printFourMetricsAt(vesting, WALLET_A, TS_2029_0601_1300);
        await printFourMetricsAt(vesting, WALLET_B, TS_2029_0601_1300);
    });

    it('[ADHOC]: 2029-06-02 13:00 기준 가격/베스팅 지표 출력', async function () {
        // 1) 현재 시각 A에서 한 번 sync
        await vesting.sync();
        const A = (await ethers.provider.getBlock('latest')).timestamp;

        // 2) 체인 시간을 미래(2026-06-01 13:00:00 UTC)로 이동
        const TS_2029_0602_1300 = Math.floor(Date.parse('2029-06-02T13:00:00Z') / 1000);
        await setNextBlockTimestamp(TS_2029_0602_1300);

        // 3) 주(7일) 단위로 syncLimitDay 진행 + 잔여 처리
        await syncWeeklyUntil(vesting, VEST_START, TS_2029_0602_1300);

        // 4) 글로벌(총 판매수/1박스 가격) 출력 — 이 시점 상태로
        await printTotalBoxPurchased(vesting);

        // 5) 두 지갑의 4가지 지표 출력 (claimable/earnedYesterday, buyer/ref)
        await printFourMetricsAt(vesting, WALLET_A, TS_2029_0602_1300);
        await printFourMetricsAt(vesting, WALLET_B, TS_2029_0602_1300);
    });
});


