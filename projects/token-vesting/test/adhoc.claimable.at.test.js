// test/adhoc.claimable.at.test.js
/**
 * @fileoverview 특정 시점(2025-08-08 15:00 KST)에서 사용자의 클레임 가능한 베스팅 보상 조회 테스트
 * @description 
 * - CSV 파일에서 사용자 정보와 구매 이력을 읽어와서
 * - TokenVesting 컨트랙트에 백필 데이터를 입력하고
 * - 특정 주소의 해당 시점에서 클레임 가능한 보상을 계산하는 테스트
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

// ===== 고정 파라미터 =====
// 베스팅 시작: 2025-06-03 00:00:00 UTC
const START_TS = 1748736000n;
// 조회 시점: 2025-08-08 15:00:00 KST = 2025-08-08 06:00:00 UTC
const QUERY_TS = 1754632800n;
// const QUERY_TS = 1754784000n; // (참고) KST 8/9 하루까지 전부 포함하고 싶을 때는 2025-08-10 00:00:00 UTC
// 대상 주소
const TARGET = "0xC5C3a14f8cDAC2300cB4Cd779046491B30c750B8";

// ===== CSV 유틸 =====
/**
 * @notice CSV 파일을 읽어오는 함수
 * @param p 파일 경로
 * @returns CSV 파일 내용
 * @throws 파일이 존재하지 않으면 에러 발생
 */
function mustRead(p) {
  if (!fs.existsSync(p)) throw new Error(`CSV not found: ${p}`);
  return fs.readFileSync(p, "utf8");
}

/**
 * @notice 사용자 CSV 파일을 파싱하여 레퍼럴 코드 정보를 추출
 * @param csvText CSV 파일의 텍스트 내용
 * @returns {wallet: string, code: string}[] 형태의 사용자 정보 배열
 * @description 
 * - 헤더가 있는 경우 자동으로 인식하여 wallet과 referral_code 컬럼 찾기
 * - 헤더가 없는 경우 기본 컬럼 순서(0: wallet, 1: code) 사용
 * - 다양한 컬럼명에 대응 (wallet/address/wallet_address, referral_code/refcode/code)
 */
function parseUsersCsv(csvText) {
  const lines = csvText.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  if (!lines.length) return [];
  const header = lines[0].split(",").map(s=>s.trim().toLowerCase());
  let start=0, w=0, c=1;
  const hasHeader = ["wallet_address","referral_code"].some(h=>header.includes(h));
  if (hasHeader) {
    w = header.findIndex(h=>["wallet_address"].includes(h));
    c = header.findIndex(h=>["referral_code"].includes(h));
    if (w<0 || c<0) throw new Error("user.csv header not recognized");
    start=1;
  }
  const rows=[];
  for (let i=start;i<lines.length;i++){
    const cols = lines[i].split(",").map(s=>s.trim());
    const wallet = cols[w], code = cols[c];
    if (wallet && code) rows.push({ wallet, code });
  }
  return rows;
}

/**
 * @notice 구매 이력 CSV 파일을 파싱하여 구매 정보를 추출
 * @param csvText CSV 파일의 텍스트 내용
 * @returns {wallet: string, ref: string, amount: string, price: string, time: string}[] 형태의 구매 정보 배열
 * @description 
 * - 헤더가 있는 경우 자동으로 인식하여 필요한 컬럼들 찾기
 * - 헤더가 없는 경우 기본 컬럼 순서 사용
 * - 다양한 컬럼명에 대응하여 유연하게 파싱
 */
function parsePurchasesCsv(csvText) {
  const lines = csvText.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  if (!lines.length) return [];
  const header = lines[0].split(",").map(s=>s.trim().toLowerCase());
  let start=0;
  const idx = {
    wallet: header.findIndex(h=>["wallet_address"].includes(h)),
    ref:    header.findIndex(h=>["referral"].includes(h)),
    amount: header.findIndex(h=>["amount"].includes(h)),
    price:  header.findIndex(h=>["avg_price"].includes(h)),
    time:   header.findIndex(h=>["updated_at"].includes(h)),
  };
  const hasHeader = Object.values(idx).some(i=>i!==-1);
  if (hasHeader) {
    if (idx.wallet<0 || idx.amount<0 || idx.price<0 || idx.time<0) throw new Error("purchase_history.csv header not recognized");
    start=1;
  } else {
    idx.wallet=0; idx.ref=1; idx.amount=2; idx.price=3; idx.time=4;
  }
  const rows=[];
  for (let i=start;i<lines.length;i++){
    const cols = lines[i].split(",").map(s=>s.trim());
    const g = k => (idx[k] >=0 && idx[k] < cols.length) ? cols[idx[k]] : "";
    const wallet = g("wallet"), ref=g("ref"), amount=g("amount"), price=g("price"), time=g("time");
    if (wallet && amount && price && time) rows.push({ wallet, ref, amount, price, time });
  }
  return rows;
}

/**
 * @notice 레퍼럴 코드를 정규화하고 유효성 검증
 * @param code 원본 레퍼럴 코드
 * @returns 정규화된 8자리 대문자 코드 또는 빈 문자열
 * @throws 유효하지 않은 코드 형식이면 에러 발생
 * @description 
 * - 빈 값이면 빈 문자열 반환
 * - 8자리 A-Z, 0-9 조합만 허용
 * - 대문자로 정규화
 */
function normCodeMaybeEmpty(code){
  const c = String(code||"").trim();
  if (!c) return "";
  const up = c.toUpperCase();
  if (!/^[A-Z0-9]{8}$/.test(up)) throw new Error(`Invalid referral code: ${code}`);
  return up;
}

/**
 * @notice 박스 수량을 파싱하여 BigInt로 변환
 * @param v 박스 수량 문자열
 * @returns BigInt 형태의 박스 수량
 * @throws 숫자가 아닌 값이면 에러 발생
 */
function parseBoxCount(v){
  const s = String(v).trim();
  if (!/^\d+$/.test(s)) throw new Error(`Invalid amount: ${v}`);
  return BigInt(s);
}

/**
 * @notice USDT 6자리 소수점 금액을 파싱하여 최소 단위로 변환
 * @param v USDT 금액 문자열 (예: "100", "100.5", "100.123456")
 * @returns BigInt 형태의 최소 단위 금액 (6자리 소수점 기준)
 * @description 
 * - 정수: "100" → 100000000 (100 USDT)
 * - 소수: "100.5" → 100500000 (100.5 USDT)
 * - 6자리 초과 소수점은 절삭
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
 * @notice 다양한 형식의 날짜/시간을 Unix timestamp(초)로 변환
 * @param v 날짜/시간 문자열
 * @returns BigInt 형태의 Unix timestamp (초)
 * @description 
 * - 10자리 timestamp: "1234567890" → 1234567890n
 * - 13자리 timestamp: "1234567890123" → 1234567890n (밀리초 → 초 변환)
 * - ISO 형식: "2025-06-03 00:00:00" → Unix timestamp
 * - 다양한 날짜 형식에 대응하여 자동 변환
 */
function parseEpochSec(v){
  const t = String(v).trim();
  if (/^\d{10}$/.test(t)) return BigInt(t);
  if (/^\d{13}$/.test(t)) return BigInt(t)/1000n;
  let iso = t;
  if (!/[zZ]|[+\-]\d{2}:?\d{2}/.test(t)) iso = t.replace(" ","T")+"Z";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new Error(`Bad datetime: ${v}`);
  return BigInt(Math.floor(ms/1000));
}

/**
 * @notice 18자리 소수점 금액을 6자리 소수점으로 절삭 (내림)
 * @param amount18n 18자리 소수점 BigInt 금액
 * @returns 6자리 소수점으로 절삭된 BigInt 금액
 * @description 
 * - 18자리 → 6자리 변환 시 하위 12자리 절삭
 * - 항상 내림 처리하여 과다 지급 방지
 * - 예: 1234567890123456789n → 1234567890123000000n
 */
function floor6(amount18n){
  const mod = 10n**12n; // 1e12
  return amount18n - (amount18n % mod);
}

/**
 * @describe 특정 시점에서 사용자의 클레임 가능한 베스팅 보상 조회 테스트
 * @description 
 * 1. CSV 파일에서 사용자 정보와 구매 이력을 읽어옴
 * 2. TokenVesting 컨트랙트에 백필 데이터를 입력
 * 3. 특정 주소의 해당 시점에서 클레임 가능한 보상을 계산
 * 4. 보유량과 경과 일수 정보도 함께 출력
 */
describe("adhoc.claimable.at", function () {
  /**
   * @test 2025-08-08 15:00 KST 시점의 purchase/referral 클레임 가능액 조회
   * @description 
   * - CSV 데이터를 기반으로 실제 구매 이력을 시뮬레이션
   * - 특정 시점에서의 클레임 가능한 보상 계산
   * - 보유량, 경과 일수 등 상세 정보 출력
   */
  it("2025-08-08 15:00 KST 시점의 purchase/referral 클레임 가능액 조회", async () => {
    const [owner] = await ethers.getSigners();

    // 1) 컨트랙트 배포 (시작시각 고정)
    const StableCoin = await ethers.getContractFactory("StableCoin");
    const stableCoin = await StableCoin.deploy();

    // ── TokenVesting 배포 (새 생성자: forwarder, stableCoin, start)
    const TV = await ethers.getContractFactory("TokenVesting");
    const vesting = await TV.deploy(
      ethers.ZeroAddress,
      await stableCoin.getAddress(),
      START_TS
    );

    // ── BadgeSBT 배포: admin = vesting (mint/upgrade가 onlyAdmin이므로)
    const BadgeSBT = await ethers.getContractFactory("BadgeSBT");
    const sbt = await BadgeSBT.deploy("Badge", "BDG", await vesting.getAddress());

    // ── TokenVesting에 SBT 주소 연결
    await vesting.setBadgeSBT(await sbt.getAddress());

    // 4개 term(각 365일), 기존 테스트와 동일 토큰양
    const DAY = 86400n;
    // const ends = [
    //   START_TS - 1n + DAY * 365n,
    //   START_TS - 1n + DAY * 365n * 2n,
    //   START_TS - 1n + DAY * 365n * 3n,
    //   START_TS - 1n + DAY * 365n * 4n,
    // ];
    const ends = [
      1780444799n,
      1811980799n,
      1843603199n,
      1875139199n
    ];
    const buyerTotals = [
      ethers.parseEther("170000000"),
      ethers.parseEther("87500000"),
      ethers.parseEther("52500000"),
      ethers.parseEther("40000000"),
    ];
    const refTotals = [
      ethers.parseEther("15000000"),
      ethers.parseEther("15000000"),
      0n,
      0n,
    ];
    await vesting.initializeSchedule(ends, buyerTotals, refTotals);

    // 2) user.csv → setReferralCodesBulk
    // CSV 파일에서 사용자 정보를 읽어와서 레퍼럴 코드를 일괄 설정
    const userCsv = mustRead(path.join(__dirname, "../test/data", "user.csv"));
    const userRows = parseUsersCsv(userCsv);
    const users = userRows.map(r => ethers.getAddress(r.wallet));
    const codes = userRows.map(r => {
      const norm = normCodeMaybeEmpty(r.code);
      if (!norm) throw new Error(`Empty code in user.csv for ${r.wallet}`);
      return norm;
    });

    // setReferralCodesBulk 함수가 있으면 일괄 설정, 없으면 개별 설정
    if (typeof vesting.setReferralCodesBulk === "function") {
      await vesting.connect(owner).setReferralCodesBulk(users, codes, true);
    } else {
      for (let i=0;i<users.length;i++){
        await vesting.connect(owner).setReferralCode(users[i], codes[i], true);
      }
    }

    // 3) purchase_history.csv → backfillPurchaseAt (모든 행)
    // CSV 파일에서 구매 이력을 읽어와서 백필 데이터로 입력
    const purchaseCsv = mustRead(path.join(__dirname, "../test/data", "purchase_history.csv"));
    const rows = parsePurchasesCsv(purchaseCsv);

    for (const row of rows) {
      const buyer = ethers.getAddress(row.wallet);
      const refCodeStr = normCodeMaybeEmpty(row.ref);
      const boxCount = parseBoxCount(row.amount);
      const paidUnits = boxCount * parseUsdt6(row.price);
      const purchaseTs = parseEpochSec(row.time);

      await vesting.connect(owner).backfillPurchaseAt(
        buyer,
        refCodeStr,       // ""이면 레퍼럴 없음
        boxCount,
        purchaseTs,
        paidUnits,
        true              // creditBuyback
      );
    }

    // 4) 특정 주소의 해당 시점(QUERY_TS) claimable 조회
    const target = ethers.getAddress(TARGET);

    // 구매자 풀과 추천인 풀의 클레임 가능한 보상 조회
    const purch18 = await vesting.previewBuyerClaimableAt(target, QUERY_TS);
    const refer18 = await vesting.previewReferrerClaimableAt(target, QUERY_TS);

    // 18자리 → 6자리 절삭하여 실제 지급 가능한 금액 계산
    const purchPay = floor6(purch18);
    const referPay = floor6(refer18);

    // ✅ 여기서 '보유 박스 수량' / '레퍼럴 유치 수량'도 같이 출력
    // dayIndex: START_TS 기준 전역 경과 일수(주소 무관)
    const dayIndex = QUERY_TS < START_TS ? 0n : (QUERY_TS - START_TS) / DAY;

    const buyerBoxesByDay = await vesting.buyerBoxesAtDay(target, dayIndex);
    const referUnitsByDay = await vesting.referralUnitsAtDay(target, dayIndex);

    console.log("\n=== Balances @ 2025-08-08 15:00 KST ===");
    console.log("Address:", target);
    console.log("day index (global from START_TS):", dayIndex.toString());
    console.log("buyer boxes:", buyerBoxesByDay.toString());
    console.log("referral units:", referUnitsByDay.toString(), "\n");

    // ✅ 주소별: 첫 구매일 기준으로 8/8까지 경과 일수 계산
    // firstEffDay: 체크포인트의 첫 day(= 구매일+1)가 나타나는 가장 이른 날
    let firstEffDay = null;
    for (let d = 0n; d <= dayIndex; d = d + 1n) {
      const bal = await vesting.buyerBoxesAtDay(target, d);
      if (bal > 0n) { firstEffDay = d; break; }
    }

    if (firstEffDay === null) {
      console.log("No purchases found for target up to the query date.");
    } else {
      // 구매일(day 인덱스) = 효력일 - 1
      const firstPurchaseDay = firstEffDay === 0n ? 0n : firstEffDay - 1n;

      // exclusive: 구매일 다음 날부터 dayIndex까지 완료된 날 수
      // inclusive: 'n일차' 표기용(구매일을 1일차로)
      const elapsedExclusive = dayIndex > firstPurchaseDay ? (dayIndex - firstPurchaseDay) : 0n;
      const elapsedInclusive = elapsedExclusive + 1n;

      console.log("firstEffDay (effective; accrual starts this day):", firstEffDay.toString());
      console.log("firstPurchaseDay (day index):", firstPurchaseDay.toString());
      console.log("elapsed days (exclusive):", elapsedExclusive.toString());
      console.log("elapsed days (inclusive):", elapsedInclusive.toString(), "\n");
    }

    // 기존 출력: 클레임 가능한 보상 정보
    console.log("=== Claimable @ 2025-08-08 15:00 KST ===");
    console.log("purchase (18dec):", purch18.toString());
    console.log("purchase (floor6->18dec):", purchPay.toString(), "(~", ethers.formatUnits(purchPay, 18), ")");
    console.log("referral  (18dec):", refer18.toString());
    console.log("referral  (floor6->18dec):", referPay.toString(), "(~", ethers.formatUnits(referPay, 18), ")\n");

    // Sanity check: 반환값이 BigInt인지 확인
    expect(purch18).to.be.a("bigint");
    expect(refer18).to.be.a("bigint");
  });
});
