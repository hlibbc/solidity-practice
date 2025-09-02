/* eslint-disable no-console */
/**
 * @fileoverview 
 *  TokenVesting 컨트랙트의 히스토리 백필 스크립트
 * @description
 *  배포 없이, 기존 배포(deployment-info.json)를 읽어
 *   1) user.csv로 레퍼럴 코드 선등록
 *   2) purchase_history.csv 전체 backfill
 *   3) (수정) .env의 VEST_EPOCH(= query_ts)까지만 sync
 * 
 * 실행 방법:
 *   npx hardhat run scripts/adhoc/backfillHistory.js --network <net>
 * 
 * 백필 프로세스:
 *  1. user.csv에서 사용자 지갑 주소와 레퍼럴 코드 읽기
 *  2. 레퍼럴 코드를 컨트랙트에 일괄 등록
 *  3. purchase_history.csv에서 구매 내역 읽기
 *  4. 각 구매 내역을 backfillPurchaseAt으로 백필
 *  5. (수정) VEST_EPOCH 환경변수에 지정된 시각까지만 syncLimitDay 실행
 * 
 * 환경변수:
 *  - VEST_EPOCH: sync를 제한할 시각(epoch) - 설정 시 해당 시각까지만 동기화
 * 
 * 주의사항:
 *  - 이 스크립트를 여러 번 실행하면 backfill이 중복 반영됩니다.
 *  - 컨트랙트가 중복 방어를 하지 않으므로, 같은 CSV를 재주입하지 마세요!
 *  - CSV 데이터의 정확성과 일관성을 사전에 검증해야 합니다.
 * 
 * @author hlibbc
 */
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { ethers } = hre;

// =============================================================================
// 환경변수 설정
// =============================================================================

// ── (추가) .env 로드: scripts/adhoc 기준 상위 상위에 .env가 있다고 하셨죠.
require("dotenv").config({ path: path.join(__dirname, "../.env") });

// =============================================================================
// 유틸리티 함수 (환경변수 사용 안 함)
// =============================================================================

/**
 * @description 파일 경로의 텍스트 내용을 읽어오는 함수
 * @param {string} p - 읽을 파일의 경로
 * @returns {string} 파일의 텍스트 내용
 * @throws {Error} 파일이 존재하지 않을 경우
 * 
 * 파일 존재 여부를 먼저 확인하고, 존재하지 않으면 에러를 발생시킴
 * UTF-8 인코딩으로 파일을 읽어서 반환
 */
function mustRead(p) {
    if (!fs.existsSync(p)) throw new Error(`File not found: ${p}`);
    return fs.readFileSync(p, "utf8");
}

/**
 * @description 배포 정보 파일을 로드하는 함수
 * @returns {Object} 배포 정보 객체
 * @throws {Error} deployment-info.json 파일이 존재하지 않을 경우
 * 
 * ./output/deployment-info.json 파일을 읽어서 JSON으로 파싱
 * deployContracts.js 실행 후에 생성되는 파일
 */
function loadDeploymentInfo() {
    const p = path.join(__dirname, "./output/deployment-info.json");
    if (!fs.existsSync(p)) {
        throw new Error(`deployment-info.json not found: ${p}\n(먼저 deployContracts.js 실행)`);
    }
    return JSON.parse(fs.readFileSync(p, "utf8"));
}

/**
 * @description 사용자 CSV 파일을 파싱하여 레퍼럴 코드 정보를 추출하는 함수
 * @param {string} csvText - CSV 파일의 텍스트 내용
 * @returns {Array<Object>} 파싱된 사용자 정보 배열
 * 
 * CSV 파싱 규칙:
 *  - 헤더가 있는 경우: wallet_address, referral_code 컬럼을 자동 인식
 *  - 헤더가 없는 경우: 첫 번째 행부터 데이터로 처리 (0,1 인덱스)
 *  - 빈 행은 자동으로 필터링
 *  - 각 컬럼의 공백은 자동으로 제거
 * 
 * 반환 데이터 구조:
 *  - wallet: 지갑 주소
 *  - code: 레퍼럴 코드
 * 
 * 필수 컬럼:
 *  - wallet_address: 사용자 지갑 주소
 *  - referral_code: 레퍼럴 코드 (8자리 영숫자)
 */
function parseUsersCsv(csvText) {
    // === CSV 텍스트를 행별로 분리 및 전처리 ===
    const lines = csvText.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    if (!lines.length) return [];
    
    // === 헤더 파싱 및 컬럼 인덱스 매핑 ===
    const header = lines[0].split(",").map(s=>s.trim().toLowerCase());
    let start=0, w=0, c=1;
    
    // === 헤더 존재 여부 확인 ===
    const hasHeader = ["wallet_address","referral_code"].some(h=>header.includes(h));
    if (hasHeader) {
        w = header.findIndex(h=>["wallet_address"].includes(h));
        c = header.findIndex(h=>["referral_code"].includes(h));
        if (w<0 || c<0) throw new Error("user.csv header not recognized");
        start=1; // 헤더가 있으면 첫 번째 행부터 데이터 시작
    }
    
    // === 데이터 행 파싱 ===
    const rows=[];
    for (let i=start;i<lines.length;i++){
        const cols = lines[i].split(",").map(s=>s.trim());
        const wallet = cols[w], code = cols[c];
        if (wallet && code) rows.push({ wallet, code });
    }
    
    return rows;
}

/**
 * @description 구매 내역 CSV 파일을 파싱하여 구조화된 데이터로 변환하는 함수
 * @param {string} csvText - CSV 파일의 텍스트 내용
 * @returns {Array<Object>} 파싱된 구매 내역 배열
 * 
 * CSV 파싱 규칙:
 *  - 헤더가 있는 경우: wallet_address, referral_code, amount, updated_at 컬럼을 자동 인식
 *  - 헤더가 없는 경우: 첫 번째 행부터 데이터로 처리 (0,1,2,4 인덱스)
 *  - 빈 행은 자동으로 필터링
 *  - 각 컬럼의 공백은 자동으로 제거
 * 
 * 컬럼 매핑:
 *  - wallet: 지갑 주소 (wallet_address)
 *  - ref: 레퍼럴 코드 (referral, referral_code)
 *  - amount: 박스 수량 (amount)
 *  - time: 구매 시각 (updated_at)
 *  - price: 고정 단가 (300 USDT, 테스트와 동일)
 * 
 * 반환 데이터 구조:
 *  - wallet: 지갑 주소
 *  - ref: 레퍼럴 코드
 *  - amount: 박스 수량
 *  - price: 고정 단가
 *  - time: 구매 시각
 * 
 * 필수 컬럼:
 *  - wallet_address: 구매자 지갑 주소
 *  - amount: 구매한 박스 수량
 *  - updated_at: 구매 시각
 */
function parsePurchasesCsv(csvText) {
    // === CSV 텍스트를 행별로 분리 및 전처리 ===
    const lines = csvText.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    if (!lines.length) return [];
    
    // === 헤더 파싱 및 컬럼 인덱스 매핑 ===
    const header = lines[0].split(",").map(s=>s.trim().toLowerCase());
    let start=0;
    const idx = {
        wallet: header.findIndex(h=>["wallet_address"].includes(h)),
        ref:    header.findIndex(h=>["referral", "referral_code"].includes(h)),
        amount: header.findIndex(h=>["amount"].includes(h)),
        time:   header.findIndex(h=>["updated_at"].includes(h)),
    };
    
    // === 헤더 존재 여부 확인 및 시작 인덱스 설정 ===
    const hasHeader = Object.values(idx).some(i=>i!==-1);
    if (hasHeader) {
        if (idx.wallet<0 || idx.time<0) throw new Error("purchase_history.csv header not recognized");
        start=1; // 헤더가 있으면 첫 번째 행부터 데이터 시작
    } else {
        // 헤더가 없으면 기본 인덱스 사용 (0,1,2,4)
        idx.wallet=0; 
        idx.ref=1; 
        idx.amount=2; 
        idx.time=4;
    }
    
    // === 데이터 행 파싱 ===
    const rows=[];
    for (let i=start;i<lines.length;i++){
        const cols = lines[i].split(",").map(s=>s.trim());
        
        // === 컬럼 값 추출 함수 ===
        const g = k => (idx[k] >=0 && idx[k] < cols.length) ? cols[idx[k]] : "";
        
        const wallet = g("wallet"), ref=g("ref"), amount=g("amount"), time=g("time");
        const price = "300"; // 고정 단가(테스트와 동일)
        
        // === 필수 필드가 모두 있는 경우만 추가 ===
        if (wallet && amount && price && time) rows.push({ wallet, ref, amount, price, time });
    }
    
    return rows;
}

/**
 * @description 레퍼럴 코드를 정규화하고 유효성을 검증하는 함수
 * @param {string} code - 검증할 레퍼럴 코드
 * @returns {string} 정규화된 레퍼럴 코드
 * @throws {Error} 유효하지 않은 레퍼럴 코드 형식일 경우
 * 
 * 정규화 규칙:
 *  - 공백 제거
 *  - 대문자로 변환
 *  - 8자리 영숫자 형식 검증 (A-Z, 0-9)
 * 
 * 유효하지 않은 코드는 에러를 발생시킴
 * 이는 백필 과정에서 데이터 무결성을 보장하기 위함
 */
function normCodeMaybeEmpty(code){
    const c = String(code||"").trim();
    if (!c) return "";
    
    const up = c.toUpperCase();
    if (!/^[A-Z0-9]{8}$/.test(up)) throw new Error(`Invalid referral code: ${code}`);
    
    return up;
}

/**
 * @description 박스 수량을 파싱하여 BigInt로 변환하는 함수
 * @param {string} v - 파싱할 박스 수량 문자열
 * @returns {BigInt} 박스 수량
 * @throws {Error} 유효하지 않은 수량 형식일 경우
 * 
 * 파싱 규칙:
 *  - 공백 제거
 *  - 정수 형식 검증 (0 이상의 정수만 허용)
 *  - BigInt로 변환하여 반환
 * 
 * 0개 박스는 유효하지 않음 (에러 발생)
 */
function parseBoxCount(v){
    const s = String(v).trim();
    if (!/^\d+$/.test(s)) throw new Error(`Invalid amount: ${v}`);
    return BigInt(s);
}

/**
 * @description USDT 금액을 파싱하여 6자리 소수점 단위로 변환하는 함수
 * @param {string} v - 파싱할 USDT 금액 문자열
 * @returns {BigInt} 6자리 소수점 단위 USDT 금액
 * 
 * 파싱 규칙:
 *  - 공백 제거
 *  - 정수 형식: 6자리 소수점 자동 추가
 *  - 소수점 형식: 소수점 이하 6자리까지 처리
 *  - 예: "300" → 300000000, "300.5" → 300500000
 * 
 * 반환값은 6자리 소수점 단위 (USDT의 표준 소수점)
 */
function parseUsdt6(v){
    const s = String(v).trim();
    
    // === 정수 형식 처리 ===
    if (/^\d+$/.test(s)) return BigInt(s) * 10n**6n;
    
    // === 소수점 형식 처리 ===
    const [L,R=""] = s.split(".");
    const left = (L||"0").replace(/[^\d]/g,"");
    const right = (R.replace(/[^\d]/g,"")+"000000").slice(0,6);
    
    return BigInt(left||"0")*10n**6n + BigInt(right||"0");
}

/**
 * @description 시간 문자열을 파싱하여 epoch 초 단위로 변환하는 함수
 * @param {string} v - 파싱할 시간 문자열
 * @returns {BigInt} epoch 초 단위 시간
 * @throws {Error} 유효하지 않은 시간 형식일 경우
 * 
 * 지원하는 시간 형식:
 *  - epoch 초: 10자리 숫자 (예: "1640995200")
 *  - epoch 밀리초: 13자리 숫자 (예: "1640995200000")
 *  - ISO 문자열: "2022-01-01 00:00:00" → "2022-01-01T00:00:00Z"
 * 
 * 반환값은 epoch 초 단위 (Unix timestamp)
 */
function parseEpochSec(v){
    const t = String(v).trim();
    
    // === epoch 초 형식 처리 (10자리) ===
    if (/^\d{10}$/.test(t)) return BigInt(t);
    
    // === epoch 밀리초 형식 처리 (13자리) ===
    if (/^\d{13}$/.test(t)) return BigInt(t)/1000n;
    
    // === ISO 문자열 형식 처리 ===
    let iso = t;
    if (!/[zZ]|[+\-]\d{2}:?\d{2}/.test(t)) iso = t.replace(" ","T")+"Z";
    
    const ms = Date.parse(iso);
    if (Number.isNaN(ms)) throw new Error(`Bad datetime: ${v}`);
    
    return BigInt(Math.floor(ms/1000));
}

// =============================================================================
// 메인 함수
// =============================================================================

/**
 * @description TokenVesting 컨트랙트의 히스토리 백필 메인 함수
 * @description
 *  백필 프로세스:
 *  1. 배포 정보 로드 및 컨트랙트 핸들 획득
 *  2. user.csv에서 레퍼럴 코드 정보 읽기
 *  3. 레퍼럴 코드를 컨트랙트에 일괄 등록
 *  4. purchase_history.csv에서 구매 내역 읽기
 *  5. 각 구매 내역을 backfillPurchaseAt으로 백필
 *  6. (수정) VEST_EPOCH 환경변수에 지정된 시각까지만 syncLimitDay 실행
 * 
 * 백필 대상:
 *  - 사용자별 레퍼럴 코드 등록
 *  - 과거 구매 내역의 온체인 기록
 *  - 구매 시각, 박스 수량, 지불 금액, 레퍼럴 코드
 * 
 * 동기화 제한:
 *  - VEST_EPOCH 환경변수가 설정된 경우 해당 시각까지만 동기화
 *  - 설정되지 않은 경우 동기화 스킵
 *  - 이를 통해 백필과 동기화를 분리하여 실행 가능
 * 
 * 오류 처리:
 *  - CSV 파싱 오류 시 해당 행 스킵
 *  - 컨트랙트 호출 오류 시 해당 항목 스킵
 *  - 전체 프로세스 중단 방지
 * 
 * 주의사항:
 *  - 중복 실행 시 데이터 중복 반영
 *  - CSV 데이터의 정확성 사전 검증 필요
 *  - 대량 데이터 처리 시 시간 소요
 */
async function main() {
    // === 배포 정보 로드 및 컨트랙트 핸들 획득 ===
    const info = loadDeploymentInfo();
    const vestingAddr = info?.contracts?.tokenVesting;
    if (!vestingAddr) throw new Error("tokenVesting address missing in deployment-info.json");

    const [owner] = await ethers.getSigners();
    const vesting = await ethers.getContractAt("TokenVesting", vestingAddr, owner);

    // === 1) 레퍼럴 코드 선등록 ===
    const userCsvPath = path.join(__dirname, "./data/user.csv");
    const userRows = parseUsersCsv(mustRead(userCsvPath));
    
    // === 사용자 지갑 주소와 레퍼럴 코드 추출 ===
    const users = userRows.map(r => ethers.getAddress(r.wallet));
    const codes = userRows.map(r => normCodeMaybeEmpty(r.code));
    
    // === 일괄 등록 또는 개별 등록 선택 ===
    if (typeof vesting.setReferralCodesBulk === "function") {
        // === 일괄 등록 함수가 있는 경우 ===
        await (await vesting.connect(owner).setReferralCodesBulk(users, codes, true)).wait();
        console.log(`[referral] setReferralCodesBulk: ${users.length} entries`);
    } else {
        // === 개별 등록 함수만 있는 경우 ===
        for (let i=0;i<users.length;i++){
            await (await vesting.connect(owner).setReferralCode(users[i], codes[i], true)).wait();
        }
        console.log(`[referral] setReferralCode (loop): ${users.length} entries`);
    }

    // === 2) 구매 내역 백필 ===
    const purchaseCsvPath = path.join(__dirname, "./data/purchase_history.csv");
    const rows = parsePurchasesCsv(mustRead(purchaseCsvPath));
    console.log(`[info] ${rows.length} rows from CSV`);

    // === 백필 실행 및 결과 통계 ===
    let ok = 0, skipped = 0;
    for (const row of rows) {
        try {
            // === 행 데이터 파싱 및 검증 ===
            const buyer = ethers.getAddress(row.wallet);
            const refCodeStr = normCodeMaybeEmpty(row.ref);
            const boxCount = parseBoxCount(row.amount);
            
            // === 0개 박스는 스킵 ===
            if (boxCount === 0n) { 
                skipped++; 
                continue; 
            }
            
            // === 지불 금액과 구매 시각 계산 ===
            const paidUnits = boxCount * parseUsdt6(row.price);
            const purchaseTs = parseEpochSec(row.time);

            // === backfillPurchaseAt 함수 호출 ===
            await (await vesting.connect(owner).backfillPurchaseAt(
                buyer,           // 구매자 주소
                refCodeStr,      // 레퍼럴 코드 ("" 가능)
                boxCount,        // 박스 수량
                purchaseTs,      // 구매 시각 (epoch)
                paidUnits,       // 지불 금액 (6자리 소수점)
                false            // creditBuyback: 운영 요구사항에 맞게 설정
            )).wait();
            
            ok++;
        } catch (e) {
            // === 오류 발생 시 해당 행 스킵 ===
            console.warn("[skip row]", row, "\n reason:", e?.reason || e?.message || String(e));
            skipped++;
        }
    }
    console.log(`[backfill] success=${ok}, skipped=${skipped}`);

    // === 3) (수정) .env의 VEST_EPOCH(= query_ts)까지만 sync ===
    const queryTsStr = process.env.VEST_EPOCH;
    if (!queryTsStr) {
        // === VEST_EPOCH이 설정되지 않은 경우 동기화 스킵 ===
        console.log("[sync] skipped: no VEST_EPOCH in .env (set it if you want to bound sync to a cutoff)");
        console.log("✅ backfillHistory finished.");
        return;
    }

    // === 동기화 제한 시각 및 일자 계산 ===
    const START_TS = BigInt(info.startTs);
    const DAY = 86400n;
    const QUERY_TS = BigInt(queryTsStr);

    // === dTarget: QUERY_TS 기준 "완전한 하루 수(확정 총 일수 목표치)" ===
    const dTarget = QUERY_TS <= START_TS ? 0n : (QUERY_TS - START_TS) / DAY;

    try {
        // === 현재 동기화된 마지막 일자 조회 ===
        const lastSyncedDay = BigInt(await vesting.lastSyncedDay());
        
        // === 필요한 동기화 일수 계산 ===
        const need = dTarget > lastSyncedDay ? (dTarget - lastSyncedDay) : 0n;

        if (need > 0n) {
            // === 필요한 일수만큼 동기화 실행 ===
            await (await vesting.syncLimitDay(need)).wait();
            console.log(`[sync] syncLimitDay(${need.toString()}) done (lastSyncedDay: ${lastSyncedDay.toString()} -> ${dTarget.toString()})`);
        } else {
            // === 이미 최신 상태인 경우 ===
            console.log(`[sync] up-to-date (lastSyncedDay=${lastSyncedDay.toString()} >= dTarget=${dTarget.toString()})`);
        }
    } catch (e) {
        // === 동기화 오류 시 경고만 출력하고 계속 진행 ===
        console.warn("[sync] failed:", e?.reason || e?.message || String(e));
    }

    console.log("✅ backfillHistory finished.");
}

// =============================================================================
// 스크립트 실행 및 오류 처리
// =============================================================================

/**
 * @description 메인 함수 실행 및 오류 처리
 * 
 * 오류 발생 시:
 *  - 오류 메시지를 콘솔에 출력
 *  - 프로세스를 오류 코드 1로 종료
 * 
 * 이는 스크립트가 배치 처리에서 사용될 때 오류 상태를 명확히 전달하기 위함
 */
main().catch((e)=>{ 
    console.error(e); 
    process.exit(1); 
});
