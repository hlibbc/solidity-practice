// scripts/adhoc/proveTotals.js
/**
 * @fileoverview 
 *  TokenVesting 컨트랙트의 claimable 합계 증명 스크립트
 * @description
 *  - 지정 시각(UTC epoch)까지의 모든 구매자/추천인 claimable 합계를 계산
 *  - 스케줄 풀 총량과 비교하여 베스팅 시스템의 정확성 증명
 *  - CSV 데이터와 온체인 데이터의 일치성 검증
 * 
 * 실행 예시:
 *   pnpm --filter token-vesting exec npx hardhat run scripts/adhoc/proveTotals.js \
 *     --network localhost \
 *     1780452000     # ← 2026-06-03 01:00:00 UTC (원하는 epoch로 바꾸기)
 * 
 * 요구사항:
 *  - scripts/output/deployment-info.json 존재 (deployContracts.js 결과)
 *  - scripts/data/purchase_history.csv 존재 (wallet_address, referral/referral_code 컬럼)
 *  - (선택) scripts/data/user.csv 있으면 좋지만, 본 스크립트는 purchase_history.csv의 코드만으로도 referrer를 찾음
 * 
 * 증명 프로세스:
 *  1. CSV에서 구매자 지갑 주소와 레퍼럴 코드 수집
 *  2. 레퍼럴 코드를 통해 추천인 주소 매핑
 *  3. 각 주소별로 claimable 수량 계산
 *  4. 스케줄된 풀 총량과 비교하여 정확성 검증
 * 
 * 검증 항목:
 *  - 구매자 claimable 합계 vs 스케줄된 구매자 풀 총량
 *  - 추천인 claimable 합계 vs 스케줄된 추천인 풀 총량
 *  - 허용 오차: claimable 합계가 풀 총량을 초과하지 않아야 함
 * 
 * @author hlibbc
 */
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { ethers } = hre;

// =============================================================================
// 상수 정의
// =============================================================================

const DAY = 86400n; // 하루를 초 단위로 표현 (24 * 60 * 60)

// =============================================================================
// CSV 유틸리티 함수
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
function readText(p) {
    if (!fs.existsSync(p)) throw new Error(`File not found: ${p}`);
    return fs.readFileSync(p, "utf8");
}

/**
 * @description 구매 내역 CSV 파일을 파싱하여 구조화된 데이터로 변환
 * @param {string} csvText - CSV 파일의 텍스트 내용
 * @returns {Array<Object>} 파싱된 구매 내역 배열
 * 
 * CSV 파싱 규칙:
 *  - 헤더가 있는 경우: wallet_address, referral_code, amount, updated_at 컬럼을 자동 인식
 *  - 헤더가 없는 경우: 첫 번째 행부터 데이터로 처리 (0,1,2,3 인덱스)
 *  - 빈 행은 자동으로 필터링
 *  - 각 컬럼의 공백은 자동으로 제거
 * 
 * 컬럼 매핑:
 *  - wallet: 지갑 주소 (wallet_address, wallet, address)
 *  - ref: 레퍼럴 코드 (referral, referral_code, refcode, code)
 *  - amount: 박스 수량 (amount, box, boxes, quantity, count)
 *  - time: 구매 시각 (updated_at, time, timestamp, purchased_at)
 * 
 * 반환 데이터 구조:
 *  - wallet: 지갑 주소
 *  - ref: 레퍼럴 코드
 *  - amount: 박스 수량
 *  - time: 구매 시각
 */
function parsePurchasesCsv(csvText) {
    // === CSV 텍스트를 행별로 분리 및 전처리 ===
    const lines = csvText.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (!lines.length) return [];
    
    // === 헤더 파싱 및 컬럼 인덱스 매핑 ===
    const header = lines[0].split(",").map(s => s.trim().toLowerCase());
    let start = 0;
    const idx = {
        wallet: header.findIndex(h => ["wallet_address","wallet","address"].includes(h)),
        ref:    header.findIndex(h => ["referral","referral_code","refcode","code"].includes(h)),
        amount: header.findIndex(h => ["amount","box","boxes","quantity","count"].includes(h)),
        time:   header.findIndex(h => ["updated_at","time","timestamp","purchased_at"].includes(h)),
    };
    
    // === 헤더 존재 여부 확인 및 시작 인덱스 설정 ===
    const hasHeader = Object.values(idx).some(i => i !== -1);
    if (hasHeader) {
        if (idx.wallet < 0) throw new Error("purchase_history header missing wallet column");
        start = 1; // 헤더가 있으면 첫 번째 행부터 데이터 시작
    } else {
        // 헤더가 없으면 기본 인덱스 사용 (0,1,2,3)
        idx.wallet = 0; 
        idx.ref = 1; 
        idx.amount = 2; 
        idx.time = 3;
    }
    
    // === 데이터 행 파싱 ===
    const rows = [];
    for (let i = start; i < lines.length; i++) {
        const cols = lines[i].split(",").map(s => s.trim());
        
        // === 컬럼 값 추출 함수 ===
        const g = k => (idx[k] >= 0 && idx[k] < cols.length) ? cols[idx[k]] : "";
        
        const wallet = g("wallet");
        const ref = g("ref");
        const amount = g("amount");
        const time = g("time");
        
        // === 유효한 지갑 주소가 있는 경우만 추가 ===
        if (wallet) rows.push({ wallet, ref, amount, time });
    }
    
    return rows;
}

/**
 * @description 레퍼럴 코드를 정규화하고 유효성을 검증하는 함수
 * @param {string} s - 검증할 레퍼럴 코드
 * @returns {string} 정규화된 레퍼럴 코드 또는 빈 문자열
 * 
 * 정규화 규칙:
 *  - 공백 제거
 *  - 대문자로 변환
 *  - 8자리 영숫자 형식 검증 (A-Z, 0-9)
 *  - 유효하지 않은 코드는 빈 문자열 반환
 * 
 * 코드가 이상하면 그냥 무시하여 해당 구매는 추천 없음 취급
 * 이는 CSV 데이터의 오류나 백필 시 자동 생성되지 않은 케이스를 안전하게 처리
 */
function normRefCodeMaybeEmpty(s) {
    const c = String(s || "").trim();
    if (!c) return "";
    
    const up = c.toUpperCase();
    if (!/^[A-Z0-9]{8}$/.test(up)) return ""; // 코드가 이상하면 그냥 무시(해당 구매는 추천 없음 취급)
    
    return up;
}

// =============================================================================
// 메인 함수
// =============================================================================

/**
 * @description TokenVesting 컨트랙트의 claimable 합계 증명 메인 함수
 * @description
 *  증명 프로세스:
 *  1. 명령행 인자에서 대상 시각(epoch) 파싱
 *  2. 배포 정보 및 컨트랙트 핸들 획득
 *  3. CSV에서 구매자 및 레퍼럴 코드 수집
 *  4. 레퍼럴 코드를 통해 추천인 주소 매핑
 *  5. 각 주소별 claimable 수량 계산
 *  6. 스케줄된 풀 총량과 비교하여 정확성 검증
 *  7. 증명 결과 리포트 출력
 * 
 * 검증 로직:
 *  - 구매자 claimable 합계 ≤ 스케줄된 구매자 풀 총량
 *  - 추천인 claimable 합계 ≤ 스케줄된 추천인 풀 총량
 *  - 허용 오차: claimable 합계가 풀 총량을 초과하지 않아야 함
 *  - 일별 정수 나눗셈으로 인한 dust는 허용
 * 
 * 오류 처리:
 *  - 필수 인자 누락 시 사용법 안내 후 종료
 *  - 배포 정보 파일 누락 시 에러 발생
 *  - CSV 파싱 오류 시 에러 발생
 *  - 컨트랙트 호출 오류 시 해당 항목 스킵
 */
async function main() {
    // === 명령행 인자 파싱: epoch(필수) ===
    const args = process.argv.slice(2).filter(a => !a.startsWith("--network"));
    const epochArg = args[0];
    if (!epochArg) {
        console.error("Usage: npx hardhat run scripts/adhoc/proveTotals.js --network <net> <epoch>");
        process.exit(1);
    }
    const TARGET_TS = BigInt(epochArg);

    // === 배포 정보 로드 ===
    const deployFile = path.join(__dirname, "../output/deployment-info.json");
    const info = JSON.parse(readText(deployFile));
    const vestingAddr = info.contracts?.tokenVesting;
    if (!vestingAddr) throw new Error("tokenVesting address missing in deployment-info.json");

    // === 컨트랙트 핸들 획득 ===
    const [caller] = await ethers.getSigners();
    const vesting = await ethers.getContractAt("TokenVesting", vestingAddr, caller);

    // === 스케줄/시작시각 정보 추출 ===
    const startTs = BigInt(info.startTs);
    const poolEnds = info.schedule?.ends?.map(x => BigInt(x)) ?? [];
    const buyerPools = info.schedule?.buyerTotals?.map(x => BigInt(x)) ?? [];
    const refTotals = info.schedule?.refTotals?.map(x => BigInt(x)) ?? [];

    // === 기본 정보 출력 ===
    console.log("vesting @", vestingAddr);
    console.log("startTs =", startTs.toString(), new Date(Number(startTs)*1000).toISOString());
    console.log("queryTs =", TARGET_TS.toString(), new Date(Number(TARGET_TS)*1000).toISOString());

    // === 구매 CSV에서 "참여한 지갑들"과 "사용된 레퍼럴 코드" 수집 ===
    const csvPath = path.join(__dirname, "../data/purchase_history.csv");
    const csv = readText(csvPath);
    const rows = parsePurchasesCsv(csv);

    // === 구매자 지갑 주소와 레퍼럴 코드 수집 ===
    const buyers = new Set();
    const refCodes = new Set();
    for (const r of rows) {
        try {
            // === 지갑 주소 정규화 및 추가 ===
            buyers.add(ethers.getAddress(r.wallet));
        } catch {
            // === 잘못된 주소 형식은 무시 ===
        }
        
        // === 레퍼럴 코드 정규화 및 추가 ===
        const code = normRefCodeMaybeEmpty(r.ref);
        if (code) refCodes.add(code);
    }

    // === 코드 → 추천인 주소 매핑(컨트랙트 질의) ===
    const referrers = new Set();
    for (const code of refCodes) {
        try {
            const addr = await vesting.getRefererByCode(code);
            if (addr && addr !== ethers.ZeroAddress) {
                referrers.add(ethers.getAddress(addr));
            }
        } catch {
            // === 코드가 신규/무효면 스킵 (백필 시 자동 생성 안된 케이스 등) ===
        }
    }

    // === 구매자 claimable 합계 계산(18dec) ===
    let totalBuyer18 = 0n;
    let cntB = 0;
    for (const a of buyers) {
        const v = await vesting.previewBuyerClaimableAt(a, TARGET_TS);
        totalBuyer18 += BigInt(v.toString());
        cntB++;
    }

    // === 추천인 claimable 합계 계산(18dec) ===
    let totalRef18 = 0n;
    let cntR = 0;
    for (const a of referrers) {
        const v = await vesting.previewReferrerClaimableAt(a, TARGET_TS);
        totalRef18 += BigInt(v.toString());
        cntR++;
    }

    // === 이 시점까지 "완료된 연차"의 풀 총량 계산 ===
    // (끝시각 inclusive + _termDays(+1) 기준이라면, 연차 y는 endTs[y] <= TARGET_TS 이면 전부 완료)
    let buyerPoolDone = 0n;
    let refPoolDone = 0n;
    for (let y = 0; y < poolEnds.length; y++) {
        if (poolEnds[y] <= TARGET_TS) {
            buyerPoolDone += BigInt(buyerPools[y]);
            refPoolDone   += BigInt(refTotals[y]);
        } else {
            break; // === 아직 완료되지 않은 연차는 계산에서 제외 ===
        }
    }

    // === 결과 출력 ===
    const fmt18 = (x) => ethers.formatUnits(x.toString(), 18);

    console.log("\n=== PROOF REPORT @", new Date(Number(TARGET_TS)*1000).toISOString(), "===\n");
    
    // === 구매자 증명 결과 ===
    console.log("[BUYER] addresses:", cntB);
    console.log(" sum(claimable_18)        :", totalBuyer18.toString(), "(~", fmt18(totalBuyer18), ")");
    console.log(" expected pool done (18)  :", buyerPoolDone.toString(), "(~", fmt18(buyerPoolDone), ")");
    console.log(" delta (expected - actual):", (buyerPoolDone - totalBuyer18).toString(), "(~", fmt18(buyerPoolDone - totalBuyer18), ")");
    console.log(" note: delta>=0 expected (per-day integer division dust)\n");

    // === 추천인 증명 결과 ===
    console.log("[REFERRAL] addresses:", cntR);
    console.log(" sum(claimable_18)        :", totalRef18.toString(), "(~", fmt18(totalRef18), ")");
    console.log(" expected pool done (18)  :", refPoolDone.toString(), "(~", fmt18(refPoolDone), ")");
    console.log(" delta (expected - actual):", (refPoolDone - totalRef18).toString(), "(~", fmt18(refPoolDone - totalRef18), ")");
    console.log(" note: delta>=0 expected (per-day integer division dust)\n");

    // === 간단 검증(허용오차: 0 이상) ===
    if (buyerPoolDone >= totalBuyer18 && refPoolDone >= totalRef18) {
        console.log("✅ PROOF OK: claimable sums do not exceed scheduled pools up to target ts.");
    } else {
        console.log("❌ WARNING: sums exceed pool (check schedule/ts/CSV/backfill duplication).");
    }
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
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
