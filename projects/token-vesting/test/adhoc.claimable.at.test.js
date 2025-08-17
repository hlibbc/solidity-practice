// test/adhoc.claimable.at.test.js
const { expect } = require("chai");
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

// ===== 고정 파라미터 =====
// 베스팅 시작: 2025-06-03 00:00:00 UTC
const START_TS = 1748908800n;
// 조회 시점: 2025-08-08 15:00:00 KST = 2025-08-08 06:00:00 UTC
const QUERY_TS = 1754632800n;
// const QUERY_TS = 1754784000n; // (참고) KST 8/9 하루까지 전부 포함하고 싶을 때는 2025-08-10 00:00:00 UTC
// 대상 주소
const TARGET = "0xC5C3a14f8cDAC2300cB4Cd779046491B30c750B8";

// ===== CSV 유틸 =====
function mustRead(p) {
  if (!fs.existsSync(p)) throw new Error(`CSV not found: ${p}`);
  return fs.readFileSync(p, "utf8");
}
function parseUsersCsv(csvText) {
  const lines = csvText.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  if (!lines.length) return [];
  const header = lines[0].split(",").map(s=>s.trim().toLowerCase());
  let start=0, w=0, c=1;
  const hasHeader = ["wallet","address","wallet_address","referral_code","refcode","code"].some(h=>header.includes(h));
  if (hasHeader) {
    w = header.findIndex(h=>["wallet","address","wallet_address"].includes(h));
    c = header.findIndex(h=>["referral_code","refcode","code"].includes(h));
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
function parsePurchasesCsv(csvText) {
  const lines = csvText.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  if (!lines.length) return [];
  const header = lines[0].split(",").map(s=>s.trim().toLowerCase());
  let start=0;
  const idx = {
    wallet: header.findIndex(h=>["wallet","address","wallet_address","buyer","user","account"].includes(h)),
    ref:    header.findIndex(h=>["referral","referral_code","refcode","code","ref"].includes(h)),
    amount: header.findIndex(h=>["amount","qty","quantity","box","box_count","boxes"].includes(h)),
    price:  header.findIndex(h=>["avg_price","price","unit_price","avgprice"].includes(h)),
    time:   header.findIndex(h=>["update_at","updated_at","timestamp","time","datetime","date"].includes(h)),
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
function normCodeMaybeEmpty(code){
  const c = String(code||"").trim();
  if (!c) return "";
  const up = c.toUpperCase();
  if (!/^[A-Z0-9]{8}$/.test(up)) throw new Error(`Invalid referral code: ${code}`);
  return up;
}
function parseBoxCount(v){
  const s = String(v).trim();
  if (!/^\d+$/.test(s)) throw new Error(`Invalid amount: ${v}`);
  return BigInt(s);
}
function parseUsdt6(v){
  const s = String(v).trim();
  if (/^\d+$/.test(s)) return BigInt(s) * 10n**6n;
  const [L,R=""] = s.split(".");
  const left = (L||"0").replace(/[^\d]/g,"");
  const right = (R.replace(/[^\d]/g,"")+"000000").slice(0,6);
  return BigInt(left||"0")*10n**6n + BigInt(right||"0");
}
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
function floor6(amount18n){
  const mod = 10n**12n; // 1e12
  return amount18n - (amount18n % mod);
}

describe("adhoc.claimable.at", function () {
  it("2025-08-08 15:00 KST 시점의 purchase/referral 클레임 가능액 조회", async () => {
    const [owner] = await ethers.getSigners();

    // 1) 배포 (시작시각 고정)
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
    const ends = [
      START_TS - 1n + DAY * 365n,
      START_TS - 1n + DAY * 365n * 2n,
      START_TS - 1n + DAY * 365n * 3n,
      START_TS - 1n + DAY * 365n * 4n,
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
    const userCsv = mustRead(path.join(__dirname, "../test/data", "user.csv"));
    const userRows = parseUsersCsv(userCsv);
    const users = userRows.map(r => ethers.getAddress(r.wallet));
    const codes = userRows.map(r => {
      const norm = normCodeMaybeEmpty(r.code);
      if (!norm) throw new Error(`Empty code in user.csv for ${r.wallet}`);
      return norm;
    });

    if (typeof vesting.setReferralCodesBulk === "function") {
      await vesting.connect(owner).setReferralCodesBulk(users, codes, true);
    } else {
      for (let i=0;i<users.length;i++){
        await vesting.connect(owner).setReferralCode(users[i], codes[i], true);
      }
    }

    // 3) purchase_history.csv → backfillPurchaseAt (모든 행)
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

    const purch18 = await vesting.previewBuyerClaimableAt(target, QUERY_TS);
    const refer18 = await vesting.previewReferrerClaimableAt(target, QUERY_TS);

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
      // inclusive: ‘n일차’ 표기용(구매일을 1일차로)
      const elapsedExclusive = dayIndex > firstPurchaseDay ? (dayIndex - firstPurchaseDay) : 0n;
      const elapsedInclusive = elapsedExclusive + 1n;

      console.log("firstEffDay (effective; accrual starts this day):", firstEffDay.toString());
      console.log("firstPurchaseDay (day index):", firstPurchaseDay.toString());
      console.log("elapsed days (exclusive):", elapsedExclusive.toString());
      console.log("elapsed days (inclusive):", elapsedInclusive.toString(), "\n");
    }

    // 기존 출력
    console.log("=== Claimable @ 2025-08-08 15:00 KST ===");
    console.log("purchase (18dec):", purch18.toString());
    console.log("purchase (floor6->18dec):", purchPay.toString(), "(~", ethers.formatUnits(purchPay, 18), ")");
    console.log("referral  (18dec):", refer18.toString());
    console.log("referral  (floor6->18dec):", referPay.toString(), "(~", ethers.formatUnits(referPay, 18), ")\n");

    // Sanity
    expect(purch18).to.be.a("bigint");
    expect(refer18).to.be.a("bigint");
  });
});
