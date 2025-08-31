/* eslint-disable no-console */
/**
 * @fileoverview 
 *  TokenVesting 컨트랙트의 claimable 조회 스크립트
 * @description
 *  배포 없이, 기존 배포(deployment-info.json)를 읽어
 *  - 지정 시점(epoch) / 지정 주소의 purchase/referral 클레임 가능액 및 보조 정보 조회
 * 
 * 실행 방법:
 *   VEST_EPOCH=<epoch> VEST_ADDR=<addr> npx hardhat run scripts/adhoc/queryClaimable.js --network <net>
 * 
 * 조회 기능:
 *  1. 특정 시점에서의 구매자 claimable 수량 조회
 *  2. 특정 시점에서의 추천인 claimable 수량 조회
 *  3. 해당 시점의 일별 박스 수량 및 추천 단위 조회
 *  4. 첫 번째 효과적인 베스팅 일자(firstEffDay) 탐색
 *  5. 베스팅 경과 일수 계산
 * 
 * 환경변수(../../.env 또는 쉘 주입):
 *   VEST_EPOCH=<조회 epoch(초)>, VEST_ADDR=<조회 대상 주소>
 * 
 * 조회 정보:
 *  - 구매자 claimable 수량 (18자리 소수점)
 *  - 추천인 claimable 수량 (18자리 소수점)
 *  - floor6 처리된 claimable 수량 (실제 지급 가능)
 *  - 일별 박스 수량 및 추천 단위
 *  - 베스팅 시작일부터의 경과 일수
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

// .env 로드 (상위 상위의 .env)
require("dotenv").config({ path: path.join(__dirname, "../.env") });

// =============================================================================
// 유틸리티 함수
// =============================================================================

/**
 * @description 배포 정보 파일을 로드하는 함수
 * @returns {Object} 배포 정보 객체
 * @throws {Error} deployment-info.json 파일이 존재하지 않을 경우
 * 
 * ../output/deployment-info.json 파일을 읽어서 JSON으로 파싱
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
 * @description 18자리 소수점 금액을 6자리 소수점으로 내림 처리하는 함수
 * @param {BigInt} amount18n - 18자리 소수점 금액
 * @returns {BigInt} 6자리 소수점으로 내림 처리된 금액
 * 
 * 처리 로직:
 *  - 18자리 소수점에서 6자리 소수점으로 변환
 *  - 10^12로 나눈 나머지를 제거하여 내림 처리
 *  - 실제 지급 가능한 단위로 변환
 * 
 * 예시:
 *  - 입력: 1234567890123456789n (18자리)
 *  - 출력: 1234567890123000000n (6자리로 내림)
 *  - 제거된 금액: 456789n (dust)
 */
function floor6(amount18n){
    const mod = 10n**12n;
    return amount18n - (amount18n % mod);
}

// =============================================================================
// 메인 함수
// =============================================================================

/**
 * @description TokenVesting 컨트랙트의 claimable 조회 메인 함수
 * @description
 *  조회 프로세스:
 *  1. 환경변수에서 조회 시각과 대상 주소 파싱
 *  2. 배포 정보 로드 및 컨트랙트 핸들 획득
 *  3. 구매자 및 추천인 claimable 수량 조회
 *  4. 일별 박스 수량 및 추천 단위 조회
 *  5. 첫 번째 효과적인 베스팅 일자 탐색
 *  6. 베스팅 경과 일수 계산 및 결과 출력
 * 
 * 조회 대상:
 *  - 특정 시점에서의 claimable 수량
 *  - 해당 시점의 일별 데이터
 *  - 베스팅 시작일부터의 경과 정보
 * 
 * 출력 정보:
 *  - 기본 잔액 정보 (주소, 시각, 일자 인덱스)
 *  - 일별 박스 수량 및 추천 단위
 *  - 첫 번째 효과적인 베스팅 일자
 *  - 베스팅 경과 일수 (배타적/포함적)
 *  - Claimable 수량 (18자리 및 6자리)
 *  - 첫 번째 기간의 일수
 * 
 * 주의사항:
 *  - 조회 전 sync는 자동으로 실행되지 않음
 *  - 운영 정책에 맞게 수동 호출 필요 시 따로 실행
 *  - 환경변수 설정이 필수 (VEST_EPOCH, VEST_ADDR)
 */
async function main() {
    // === 환경변수 파싱 및 검증 ===
    const epochArg = process.env.VEST_EPOCH;
    const addrArg  = process.env.VEST_ADDR;
    if (!epochArg || !addrArg) {
        console.error("Error: VEST_EPOCH and VEST_ADDR must be set (in ../../.env or shell)");
        process.exit(1);
    }
    
    // === 조회 시각과 대상 주소 설정 ===
    const QUERY_TS = BigInt(epochArg);
    const TARGET   = ethers.getAddress(addrArg);

    // === 배포 정보 로드 및 컨트랙트 핸들 획득 ===
    const info = loadDeploymentInfo();
    const vestingAddr = info?.contracts?.tokenVesting;
    if (!vestingAddr) throw new Error("tokenVesting address missing in deployment-info.json");

    // === 베스팅 시작 시각 및 일자 상수 ===
    const START_TS = BigInt(info.startTs);
    const DAY = 86400n;

    const [owner] = await ethers.getSigners();
    const vesting = await ethers.getContractAt("TokenVesting", vestingAddr, owner);

    // === 조회 전 sync는 하지 않음(운영 정책에 맞게 수동 호출 필요 시 따로 실행) ===
    // === 구매자 및 추천인 claimable 수량 조회 ===
    const purch18 = await vesting.previewBuyerClaimableAt(TARGET, QUERY_TS);
    const refer18 = await vesting.previewReferrerClaimableAt(TARGET, QUERY_TS);
    
    // === 6자리 소수점으로 내림 처리 ===
    const purchPay = floor6(purch18);
    const referPay = floor6(refer18);

    // === 일자 인덱스 계산 및 일별 데이터 조회 ===
    const dayIndex = QUERY_TS < START_TS ? 0n : (QUERY_TS - START_TS) / DAY;
    let buyerBoxesByDay = 0n, referUnitsByDay = 0n;
    
    // === 일별 박스 수량 조회 (오류 발생 시 0으로 처리) ===
    try { 
        buyerBoxesByDay = await vesting.buyerBoxesAtDay(TARGET, dayIndex); 
    } catch {}
    
    // === 일별 추천 단위 조회 (오류 발생 시 0으로 처리) ===
    try { 
        referUnitsByDay = await vesting.referralUnitsAtDay(TARGET, dayIndex); 
    } catch {}

    // === 기본 잔액 정보 출력 ===
    console.log("\n=== Balances @ QUERY ===");
    console.log("Address:", TARGET);
    console.log("start-ts, end-ts:", START_TS, QUERY_TS);
    console.log("day index (global from START_TS):", dayIndex.toString());
    console.log("buyer boxes:", buyerBoxesByDay.toString());
    console.log("referral units:", referUnitsByDay.toString(), "\n");

    // === firstEffDay 탐색 (옵션) ===
    // firstEffDay: 베스팅이 실제로 시작되는 첫 번째 일자
    // 이는 구매자가 박스를 구매한 첫 번째 일자를 의미
    let firstEffDay = null;
    for (let d = 0n; d <= dayIndex; d = d + 1n) {
        try {
            const bal = await vesting.buyerBoxesAtDay(TARGET, d);
            if (bal > 0n) { 
                firstEffDay = d; 
                break; 
            }
        } catch { 
            break; // 오류 발생 시 탐색 중단
        }
    }
    
    if (firstEffDay === null) {
        // === 구매 내역이 없는 경우 ===
        console.log("No purchases found for target up to the query date.");
    } else {
        // === 베스팅 관련 일자 계산 ===
        const firstPurchaseDay = firstEffDay === 0n ? 0n : firstEffDay - 1n;
        const elapsedExclusive = dayIndex > firstPurchaseDay ? (dayIndex - firstPurchaseDay) : 0n;
        const elapsedInclusive = elapsedExclusive + 1n;
        
        console.log("firstEffDay (effective; accrual starts this day):", firstEffDay.toString());
        console.log("firstPurchaseDay (day index):", firstPurchaseDay.toString());
        console.log("elapsed days (exclusive):", elapsedExclusive.toString());
        console.log("elapsed days (inclusive):", elapsedInclusive.toString(), "\n");
    }

    // === Claimable 수량 상세 출력 ===
    console.log("=== Claimable @ QUERY ===");
    console.log("purchase (18dec):", purch18.toString());
    console.log("purchase (floor6->18dec):", purchPay.toString(), "(~", ethers.formatUnits(purchPay, 18), ")");
    console.log("referral  (18dec):", refer18.toString());
    console.log("referral  (floor6->18dec):", referPay.toString(), "(~", ethers.formatUnits(referPay, 18), ")\n");

    // === 첫 번째 기간의 일수 계산 (옵션) ===
    try {
        const term0Days = Number((BigInt(info.schedule.ends[0]) - START_TS)/DAY + 1n);
        console.log("termDays", term0Days);
    } catch {
        // 스케줄 정보가 없거나 오류 발생 시 무시
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
main().catch((e)=>{ 
    console.error(e); 
    process.exit(1); 
});
