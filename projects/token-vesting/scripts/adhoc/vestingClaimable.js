/* eslint-disable no-console */
/**
 * @fileoverview
 *  test/adhoc.claimable.at.test.js 와 동일한 절차로 동작하는 운영 스크립트(배포 없음)
 *   1) scripts/output/deployment-info.json 에서 주소/시작시각 로드
 *   2) user.csv 로 레퍼럴 코드 선등록
 *   3) purchase_history.csv 전체 backfill
 *   4) syncLimitDay
 *   5) 지정 시점(epoch) / 지정 주소의 purchase/referral 클레임 가능액 및 보조 정보 출력
 *
 * 실행:
 *   npx hardhat run scripts/adhoc/vestingClaimable.js --network <net>
 *
 * 환경변수(../../.env):
 *   VEST_EPOCH=<조회 epoch(초)>
 *   VEST_ADDR=<조회 대상 주소>
 * @author hlibbc
 */

const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { ethers } = hre;

// ── .env: 프로젝트 기준 상위 상위 경로의 .env 사용
require("dotenv").config({ path: path.join(__dirname, "../../.env") });

/**
 * @notice 파일을 읽어오는 함수 (파일이 없으면 에러 발생)
 * @param {string} p - 파일 경로
 * @returns {string} 파일 내용
 */
function loadCSV(p) {
    if (!fs.existsSync(p)) throw new Error(`CSV not found: ${p}`);
    return fs.readFileSync(p, "utf8");
}

/**
 * @notice user.csv 파일을 파싱하여 레퍼럴 코드 정보를 추출
 * @param {string} csvText - CSV 파일 내용
 * @returns {Array<{wallet: string, code: string}>} 지갑 주소와 레퍼럴 코드 배열
 */
function parseUsersCsv(csvText) {
    const lines = csvText.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    if (!lines.length) return [];
    
    // 헤더 인덱스 찾기
    const header = lines[0].split(",").map(s=>s.trim().toLowerCase());
    let start=0, w=0, c=1;
    const hasHeader = ["wallet_address","referral_code"].some(h=>header.includes(h));
    
    if (hasHeader) {
        w = header.findIndex(h=>["wallet_address"].includes(h));
        c = header.findIndex(h=>["referral_code"].includes(h));
        if (w<0 || c<0) throw new Error("user.csv header not recognized");
        start=1;
    }
    
    // 데이터 행 파싱
    const rows=[];
    for (let i=start;i<lines.length;i++){
        const cols = lines[i].split(",").map(s=>s.trim());
        const wallet = cols[w], code = cols[c];
        if (wallet && code) rows.push({ wallet, code });
    }
    return rows;
}

/**
 * @notice purchase_history.csv 파일을 파싱하여 구매 정보를 추출
 * @param {string} csvText - CSV 파일 내용
 * @returns {Array<{wallet: string, ref: string, amount: string, price: string, time: string}>} 구매 정보 배열
 */
function parsePurchasesCsv(csvText) {
    const lines = csvText.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    if (!lines.length) return [];
    
    // 헤더 인덱스 찾기
    const header = lines[0].split(",").map(s=>s.trim().toLowerCase());
    let start=0;
    const idx = {
        wallet: header.findIndex(h=>["wallet_address"].includes(h)),
        ref:    header.findIndex(h=>["referral", "referral_code"].includes(h)),
        amount: header.findIndex(h=>["amount"].includes(h)),
        // price:  header.findIndex(h=>["avg_price"].includes(h)),
        time:   header.findIndex(h=>["updated_at"].includes(h)),
    };
    
    const hasHeader = Object.values(idx).some(i=>i!==-1);
    if (hasHeader) {
        if (idx.wallet<0 || idx.time<0) throw new Error("purchase_history.csv header not recognized");
        start=1;
    } else {
        // 헤더가 없는 경우 기본 인덱스 사용
        idx.wallet=0; idx.ref=1; idx.amount=2; idx.price=3; idx.time=4;
    }
    
    // 데이터 행 파싱
    const rows=[];
    for (let i=start;i<lines.length;i++){
        const cols = lines[i].split(",").map(s=>s.trim());
        const g = k => (idx[k] >=0 && idx[k] < cols.length) ? cols[idx[k]] : "";
        const wallet = g("wallet"), ref=g("ref"), amount=g("amount"), price="300", time=g("time");
        if (wallet && amount && price && time) rows.push({ wallet, ref, amount, price, time });
    }
    return rows;
}

/**
 * @notice 레퍼럴 코드를 정규화하고 검증
 * @param {string} code - 레퍼럴 코드
 * @returns {string} 정규화된 레퍼럴 코드 (빈 문자열이면 "")
 */
function normCodeMaybeEmpty(code){
    const c = String(code||"").trim();
    if (!c) return "";
    const up = c.toUpperCase();
    if (!/^[A-Z0-9]{8}$/.test(up)) throw new Error(`Invalid referral code: ${code}`);
    return up;
}

/**
 * @notice 박스 개수를 BigInt로 변환
 * @param {string} v - 박스 개수 문자열
 * @returns {bigint} 박스 개수
 */
function parseBoxCount(v){
    const s = String(v).trim();
    if (!/^\d+$/.test(s)) throw new Error(`Invalid amount: ${v}`);
    return BigInt(s);
}

/**
 * @notice USDT 6자리 소수점을 BigInt로 변환 (예: 300.123456 -> 300123456)
 * @param {string} v - USDT 금액 문자열
 * @returns {bigint} USDT 금액 (6자리 소수점)
 */
function parseUsdt6(v){
    const s = String(v).trim();
    if (/^\d+$/.test(s)) return BigInt(s) * 10n**6n;
    
    const [L,R=""] = s.split(".");
    const left = (L||"0").replace(/[^\d]/g,"");
    const right = (R.replace(/[^\d]/g,"")+"000000").slice(0,6);
    return BigInt(left||"0")*10n**6n + BigInt(right||"0");
}

/**
 * @notice 시간 문자열을 epoch 초 단위로 변환
 * @param {string} v - 시간 문자열 (ISO 형식, epoch 초, epoch 밀리초 등)
 * @returns {bigint} epoch 초
 */
function parseEpochSec(v){
    const t = String(v).trim();
    if (/^\d{10}$/.test(t)) return BigInt(t); // epoch 초
    if (/^\d{13}$/.test(t)) return BigInt(t)/1000n; // epoch 밀리초
    
    let iso = t;
    if (!/[zZ]|[+\-]\d{2}:?\d{2}/.test(t)) iso = t.replace(" ","T")+"Z";
    const ms = Date.parse(iso);
    if (Number.isNaN(ms)) throw new Error(`Bad datetime: ${v}`);
    return BigInt(Math.floor(ms/1000));
}

/**
 * @notice 18자리 소수점을 6자리 소수점으로 내림 처리 (USDT 단위 변환)
 * @param {bigint} amount18n - 18자리 소수점 금액
 * @returns {bigint} 6자리 소수점으로 내림 처리된 금액
 */
function floor6(amount18n){
    const mod = 10n**12n; // 1e12
    return amount18n - (amount18n % mod);
}

/**
 * @notice deployment-info.json 파일에서 배포 정보를 로드
 * @returns {Object} 배포 정보 객체
 */
function loadDeploymentInfo() {
    const p = path.join(__dirname, "../output/deployment-info.json");
    if (!fs.existsSync(p)) {
        throw new Error(`deployment-info.json not found: ${p}\n(먼저 deployContracts.js 를 실행하세요)`);
    }
    return JSON.parse(fs.readFileSync(p, "utf8"));
}

/**
 * @notice 메인함수
 */
async function main() {
    // === 입력 파라미터 검증 (.env에서 로드)
    const epochArg = process.env.VEST_EPOCH;
    const addrArg  = process.env.VEST_ADDR;
    if (!epochArg || !addrArg) {
        console.error("Error: VEST_EPOCH and VEST_ADDR must be set in ../../.env");
        process.exit(1);
    }
    const QUERY_TS = BigInt(epochArg); // 조회할 시점 (epoch)
    const TARGET   = ethers.getAddress(addrArg); // 조회할 대상 주소

    // === 배포 정보 로드
    const info = loadDeploymentInfo();
    const vestingAddr = info?.contracts?.tokenVesting; // TokenVesting 컨트랙트 주소
    const stableAddr  = info?.contracts?.stableCoin; // StableCoin 컨트랙트 주소
    const sbtAddr     = info?.contracts?.badgeSBT; // BadgeSBT 컨트랙트 주소
    
    if (!vestingAddr) throw new Error("tokenVesting address missing in deployment-info.json");
    if (!stableAddr)  console.warn("[warn] stableCoin address missing in deployment-info.json");
    if (!sbtAddr)     console.warn("[warn] badgeSBT address missing in deployment-info.json");

    const START_TS = BigInt(info.startTs); // 베스팅 시작 시점
    const DAY = 86400n; // 하루를 초 단위로

    // 컨트랙트 인스턴스 생성
    const [owner] = await ethers.getSigners();
    const vesting = await ethers.getContractAt("TokenVesting", vestingAddr, owner);

    // === 1단계: user.csv로 레퍼럴 코드 선등록 (테스트와 동일한 흐름)
    const userCsvPath = path.join(__dirname, "../data/user.csv");
    if (!userCsvPath) throw new Error("user.csv not found (scripts/data or test/data)");
    
    const userRows = parseUsersCsv(loadCSV(userCsvPath));
    const users = userRows.map(r => ethers.getAddress(r.wallet));
    const codes = userRows.map(r => {
        const norm = normCodeMaybeEmpty(r.code);
        if (!norm) throw new Error(`Empty code in user.csv for ${r.wallet}`);
        return norm;
    });

    // 벌크 등록이 가능하면 벌크로, 아니면 개별 등록
    if (typeof vesting.setReferralCodesBulk === "function") {
        await (await vesting.connect(owner).setReferralCodesBulk(users, codes, true)).wait();
        console.log(`[referral] setReferralCodesBulk: ${users.length} entries`);
    } else {
        for (let i=0;i<users.length;i++){
            await (await vesting.connect(owner).setReferralCode(users[i], codes[i], true)).wait();
        }
        console.log(`[referral] setReferralCode (loop): ${users.length} entries`);
    }

    // === 2단계: purchase_history.csv 백필 (테스트와 동일한 파서/검증)
    const purchaseCsvPath = path.join(__dirname, "../data/purchase_history.csv");
    if (!purchaseCsvPath) throw new Error("purchase_history.csv not found (scripts/data or test/data)");
    
    const rows = parsePurchasesCsv(loadCSV(purchaseCsvPath));
    console.log(`[info] ${rows.length} rows from CSV`);

    // 각 구매 기록을 백필
    let ok = 0, skipped = 0;
    for (const row of rows) {
        try {
            const buyer = ethers.getAddress(row.wallet);
            const refCodeStr = normCodeMaybeEmpty(row.ref);
            const boxCount = parseBoxCount(row.amount);
            if (boxCount === 0n) { skipped++; continue; }
            
            const paidUnits = boxCount * parseUsdt6(row.price);
            const purchaseTs = parseEpochSec(row.time);

            // 구매 기록 백필
            await (await vesting.connect(owner).backfillPurchaseAt(
                buyer,
                refCodeStr, // "" 가능 (레퍼럴 없음)
                boxCount,
                purchaseTs,
                paidUnits,
                false // creditBuyback
            )).wait();
            ok++;
        } catch (e) {
            console.warn("[skip row]", row, "\n reason:", e?.reason || e?.message || String(e));
            skipped++;
        }
    }
    console.log(`[backfill] success=${ok}, skipped=${skipped}`);

    // === 3단계: syncLimitDay (테스트와 동일 개념)
    // 조회 시점까지 경과한 완전한 일수 계산
    const fullyElapsedDays = QUERY_TS <= START_TS ? 0n : (QUERY_TS - START_TS) / DAY;
    if (fullyElapsedDays > 0n) {
        try {
            await (await vesting.syncLimitDay(fullyElapsedDays)).wait();
            console.log("[sync] syncLimitDay(", fullyElapsedDays.toString(), ") done");
        } catch (e) {
            console.warn("[sync] syncLimitDay failed/skipped:", e?.reason || e?.message || String(e));
        }
    }

    // === 4단계: 조회 및 결과 출력 (테스트와 동일 출력 포맷 근접)
    // 박스당 보상 정보 (있는 경우)
    const perBox0 = await vesting.rewardPerBox ? await vesting.rewardPerBox(0) : null;
    if (perBox0) console.log('day0 per-box =', ethers.formatUnits(perBox0, 18));

    // 클레임 가능한 금액 조회
    const purch18 = await vesting.previewBuyerClaimableAt(TARGET, QUERY_TS);    // 구매자 클레임 가능액
    const refer18 = await vesting.previewReferrerClaimableAt(TARGET, QUERY_TS); // 레퍼러 클레임 가능액
    const purchPay = floor6(purch18);  // 6자리 소수점으로 내림
    const referPay = floor6(refer18);  // 6자리 소수점으로 내림

    // 해당 일자의 박스 수와 레퍼럴 단위 조회
    const dayIndex = QUERY_TS < START_TS ? 0n : (QUERY_TS - START_TS) / DAY;
    let buyerBoxesByDay = 0n, referUnitsByDay = 0n;
    try { buyerBoxesByDay = await vesting.buyerBoxesAtDay(TARGET, dayIndex); } catch {}
    try { referUnitsByDay = await vesting.referralUnitsAtDay(TARGET, dayIndex); } catch {}

    // === 결과 출력 ===
    console.log("\n=== Balances @ QUERY ===");
    console.log("Address:", TARGET);
    console.log("start-ts, end-ts:", START_TS, QUERY_TS);
    console.log("day index (global from START_TS):", dayIndex.toString());
    console.log("buyer boxes:", buyerBoxesByDay.toString());
    console.log("referral units:", referUnitsByDay.toString(), "\n");

    // firstEffDay 계산 (테스트와 동일 아이디어)
    // 첫 번째로 구매가 발생한 유효한 일자 찾기
    let firstEffDay = null;
    for (let d = 0n; d <= dayIndex; d = d + 1n) {
        try {
            const bal = await vesting.buyerBoxesAtDay(TARGET, d);
            if (bal > 0n) { firstEffDay = d; break; }
        } catch { break; }
    }
    
    if (firstEffDay === null) {
        console.log("No purchases found for target up to the query date.");
    } else {
        const firstPurchaseDay = firstEffDay === 0n ? 0n : firstEffDay - 1n;
        const elapsedExclusive = dayIndex > firstPurchaseDay ? (dayIndex - firstPurchaseDay) : 0n;
        const elapsedInclusive = elapsedExclusive + 1n;
        
        console.log("firstEffDay (effective; accrual starts this day):", firstEffDay.toString());
        console.log("firstPurchaseDay (day index):", firstPurchaseDay.toString());
        console.log("elapsed days (exclusive):", elapsedExclusive.toString());
        console.log("elapsed days (inclusive):", elapsedInclusive.toString(), "\n");
    }

    // 클레임 가능한 금액 상세 출력
    console.log("=== Claimable @ QUERY ===");
    console.log("purchase (18dec):", purch18.toString());
    console.log("purchase (floor6->18dec):", purchPay.toString(), "(~", ethers.formatUnits(purchPay, 18), ")");
    console.log("referral  (18dec):", refer18.toString());
    console.log("referral  (floor6->18dec):", referPay.toString(), "(~", ethers.formatUnits(referPay, 18), ")\n");

    // 추가 디버깅 정보 (테스트와 유사)
    try {
        const term0Days = Number((BigInt(info.schedule.ends[0]) - START_TS)/DAY + 1n);
        console.log("termDays", term0Days);
    } catch {}
    
    try {
        const cumIdx = fullyElapsedDays > 0n ? fullyElapsedDays - 1n : 0n;
        const boxesAdded0 = await vesting.boxesAddedPerDay ? await vesting.boxesAddedPerDay(0n) : null;
        if (boxesAdded0) console.log("boxesAddedPerDay[0]", boxesAdded0.toString());
        if (vesting.cumBoxes) {
            const cb = await vesting.cumBoxes(cumIdx);
            console.log("cumBoxes ", cb.toString());
        }
    } catch {}
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
