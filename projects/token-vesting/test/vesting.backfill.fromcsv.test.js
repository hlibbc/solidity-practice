// test/vesting.backfill.fromcsv.test.js
const { expect } = require("chai");
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
const { deployFixture } = require("./helpers/vestingFixture");

//
// -------- CSV 유틸 --------
//

// 파일 탐색 (여러 후보 경로 중 최초 존재 파일 반환)
function findCsvText(candidates) {
  for (const p of candidates) {
    if (!p) continue;
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
  }
  throw new Error(
    "CSV 파일을 찾을 수 없습니다.\n" +
    candidates.filter(Boolean).join("\n")
  );
}

// user.csv 파서: (wallet,address)/(wallet_address) + (referral_code/refcode/code)
function parseUsersCsv(csvText) {
  const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  const firstCols = lines[0].split(",").map(s => s.trim());
  const lower = firstCols.map(s => s.toLowerCase());
  let startIdx = 0, walletIdx = 0, codeIdx = 1;

  const hasHeader = ["wallet","address","wallet_address","referral_code","refcode","code"]
    .some(h => lower.includes(h));

  if (hasHeader) {
    walletIdx = lower.findIndex(h => ["wallet","address","wallet_address"].includes(h));
    codeIdx   = lower.findIndex(h => ["referral_code","refcode","code"].includes(h));
    if (walletIdx === -1 || codeIdx === -1) {
      throw new Error("user.csv 헤더를 인식하지 못했습니다.");
    }
    startIdx = 1;
  }

  const rows = [];
  for (let i= startIdx; i<lines.length; i++) {
    const cols = lines[i].split(",").map(s => s.trim());
    if (cols.length < Math.max(walletIdx, codeIdx)+1) continue;
    const wallet = cols[walletIdx];
    const code   = cols[codeIdx];
    if (!wallet || !code) continue;
    rows.push({ wallet, code });
  }
  return rows;
}

// purchase_history.csv 파서
// 필드: wallet/address, referral/refcode/code(옵션), amount/qty/box(_count), avg_price/unit_price, create_at/created_at/timestamp
function parsePurchasesCsv(csvText) {
  const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  const firstCols = lines[0].split(",").map(s => s.trim());
  const lower = firstCols.map(s => s.toLowerCase());
  let startIdx = 0;

  const headerMap = {
    wallet: lower.findIndex(h => ["wallet","address","wallet_address","buyer","user","account"].includes(h)),
    ref:    lower.findIndex(h => ["referral","referral_code","refcode","code","ref"].includes(h)),
    amount: lower.findIndex(h => ["amount","qty","quantity","box","box_count","boxes"].includes(h)),
    price:  lower.findIndex(h => ["avg_price","price","unit_price","avgprice"].includes(h)),
    time:   lower.findIndex(h => ["create_at","created_at","timestamp","time","datetime","date"].includes(h)),
  };

  const hasHeader = Object.values(headerMap).some(i => i !== -1);
  if (hasHeader) {
    if (headerMap.wallet === -1 || headerMap.amount === -1 || headerMap.price === -1 || headerMap.time === -1) {
      throw new Error("purchase_history.csv 헤더(필수컬럼)를 인식하지 못했습니다.");
    }
    startIdx = 1;
  } else {
    // 무헤더: 순서 가정 [wallet, referral, amount, avg_price, create_at]
    headerMap.wallet = 0; headerMap.ref = 1;
    headerMap.amount = 2; headerMap.price = 3; headerMap.time = 4;
  }

  const rows = [];
  for (let i= startIdx; i<lines.length; i++) {
    const cols = lines[i].split(",").map(s => s.trim());
    const get = idx => (idx >= 0 && idx < cols.length ? cols[idx] : "");
    const wallet = get(headerMap.wallet);
    const ref    = get(headerMap.ref);
    const amount = get(headerMap.amount);
    const price  = get(headerMap.price);
    const time   = get(headerMap.time);
    if (!wallet || !amount || !price || !time) continue;
    rows.push({ wallet, ref, amount, price, time });
  }
  return rows;
}

// 코드 정규화/검증 (A-Z0-9 8자), 비어있으면 "" 그대로 반환
function normalizeCodeMaybeEmpty(code) {
  const c = String(code || "").trim();
  if (c === "") return "";
  const up = c.toUpperCase();
  if (!/^[A-Z0-9]{8}$/.test(up)) {
    throw new Error(`잘못된 referral 코드 형식: ${code}`);
  }
  return up;
}

// 6 decimals로 파싱 (예: "12.3456" → 12345600)
// 소수>6자리면 내림(floor)
function parseUsdtUnits6(val) {
  const s = String(val).trim();
  if (/^\d+$/.test(s)) return BigInt(s) * 10n**6n; // 정수원 단위로 표기된 "원화 가격"일 수 있음 → 기본은 달러 정수라 가정하지 말고, 아래 일반 케이스로 처리
  // 일반 케이스: 소수 포함 금액(달러) → 6dec 변환
  const parts = s.split(".");
  const left = parts[0].replace(/[^\d]/g,"") || "0";
  const rightRaw = (parts[1] || "").replace(/[^\d]/g,"");
  const right = (rightRaw + "000000").slice(0,6);
  return BigInt(left) * 10n**6n + BigInt(right || "0");
}

// amount(정수 박스 수) 파싱
function parseBoxCount(val) {
  const s = String(val).trim();
  if (!/^\d+$/.test(s)) throw new Error(`amount(정수 박스 수) 파싱 실패: ${val}`);
  return BigInt(s);
}

// create_at → epoch seconds(BigInt)
// "YYYY-MM-DD HH:mm:ss"이면 UTC 가정으로 'Z' 붙여 파싱
function parseEpochSeconds(val) {
  const t = String(val).trim();
  if (/^\d{10}$/.test(t)) return BigInt(t);          // seconds
  if (/^\d{13}$/.test(t)) return BigInt(t) / 1000n;  // millis
  let iso = t;
  if (!/[zZ]|[+\-]\d{2}:?\d{2}/.test(t)) {
    // timezone 표기 없으면 UTC 가정
    iso = t.replace(" ", "T") + "Z";
  }
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new Error(`create_at 파싱 실패: ${val}`);
  return BigInt(Math.floor(ms / 1000));
}

//
// -------- 테스트 본문 --------
//

describe("vesting.backfill.fromcsv", function () {
  it("user.csv로 코드 세팅 후, purchase_history.csv 전체 백필", async () => {
    const { owner, vesting, start } = await deployFixture();

    // 1) user.csv 로드 → setReferralCodesBulk
    const userCsv = findCsvText([path.join(__dirname, "../test/data", "user.csv")]);
    const userRows = parseUsersCsv(userCsv);
    expect(userRows.length).to.be.greaterThan(0);

    const users = [];
    const codes = [];
    for (const { wallet, code } of userRows) {
      users.push(ethers.getAddress(wallet));
      const norm = normalizeCodeMaybeEmpty(code);
      if (norm === "") throw new Error(`user.csv에 빈 코드가 있습니다: ${wallet}`);
      codes.push(norm);
    }

    if (typeof vesting.setReferralCodesBulk === "function") {
      await vesting.connect(owner).setReferralCodesBulk(users, codes, true);
    } else {
      for (let i = 0; i < users.length; i++) {
        await vesting.connect(owner).setReferralCode(users[i], codes[i], true);
      }
    }

    // 2) purchase_history.csv 로드 → 각 행 백필
    const purchaseCsv = findCsvText([path.join(__dirname, "../test/data", "purchase_history.csv")]);
    const rows = parsePurchasesCsv(purchaseCsv);
    expect(rows.length).to.be.greaterThan(0);

    // 일자별 누적 검증 맵들
    const dayTotals = new Map();     // dayIndex -> BigInt (모든 구매 박스 수)
    const refDayTotals = new Map();  // dayIndex -> BigInt (레퍼럴이 있는 구매의 박스 수)
    const allDays = new Set();       // 등장한 모든 dayIndex

    for (const row of rows) {
      const buyer = ethers.getAddress(row.wallet);
      const refCodeStr = normalizeCodeMaybeEmpty(row.ref);
      const boxCount = parseBoxCount(row.amount);
      const price6 = parseUsdtUnits6(row.price);
      const paidUnits = boxCount * price6;
      const purchaseTs = parseEpochSeconds(row.time);

      // day 인덱스 계산
      const startBn = start;
      const d = purchaseTs < startBn ? 0n : (purchaseTs - startBn) / 86400n;
      allDays.add(d);

      // 누적 합산
      dayTotals.set(d, (dayTotals.get(d) || 0n) + boxCount);
      if (refCodeStr !== "") {
        refDayTotals.set(d, (refDayTotals.get(d) || 0n) + boxCount);
      }

      // 백필 실행 (관리자)
      await vesting.connect(owner).backfillPurchaseAt(
        buyer,
        refCodeStr,    // ""이면 레퍼럴 없음
        boxCount,
        purchaseTs,
        paidUnits,
        true           // creditBuyback
      );
    }

    // 3) 검증: 일자별 boxesAddedPerDay / referralsAddedPerDay 일치
    for (const d of allDays) {
      const expectedBoxes = dayTotals.get(d) || 0n;
      const expectedRefs  = refDayTotals.get(d) || 0n;

      const onchainBoxes = await vesting.boxesAddedPerDay(d);
      const onchainRefs  = await vesting.referralsAddedPerDay(d);

      console.log(onchainBoxes, expectedBoxes)
      console.log(onchainRefs, expectedRefs)

      expect(onchainBoxes).to.equal(expectedBoxes, `boxesAddedPerDay mismatch on day ${d}`);
      expect(onchainRefs).to.equal(expectedRefs, `referralsAddedPerDay mismatch on day ${d}`);
    }
  });
});