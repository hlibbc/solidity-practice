// test/vesting.backfill.fromcsv.test.js
/**
 * @fileoverview CSV 파일을 통한 구매 이력 백필 테스트
 * @description 
 * - user.csv에서 사용자 정보와 레퍼럴 코드를 읽어와서 설정
 * - purchase_history.csv에서 구매 이력을 읽어와서 backfillPurchaseAt으로 백필
 * - 백필된 데이터가 on-chain 상태와 일치하는지 검증
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
const { deployFixture } = require("./helpers/vestingFixture");

//
// -------- CSV 유틸 --------
//

/**
 * @notice 여러 후보 경로에서 CSV 파일을 찾아서 내용을 읽어오는 함수
 * @param candidates CSV 파일 경로 후보 배열
 * @returns CSV 파일의 텍스트 내용
 * @throws 모든 후보 경로에서 파일을 찾을 수 없으면 에러 발생
 * @description 
 * - 여러 경로 후보를 순회하며 첫 번째로 존재하는 파일을 찾아서 읽기
 * - 파일이 없으면 에러 메시지와 함께 후보 경로들을 안내
 */
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

/**
 * @notice user.csv 파일을 파싱하여 사용자 정보와 레퍼럴 코드를 추출
 * @param csvText CSV 파일의 텍스트 내용
 * @returns {wallet: string, code: string}[] 형태의 사용자 정보 배열
 * @description 
 * - 헤더가 있는 경우 wallet_address와 referral_code 컬럼을 자동으로 찾기
 * - 헤더가 없는 경우 기본 컬럼 순서(0: wallet, 1: code) 사용
 * - 다양한 컬럼명에 대응하여 유연하게 파싱
 * - 빈 행이나 유효하지 않은 행은 자동으로 필터링
 */
function parseUsersCsv(csvText) {
  const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  const firstCols = lines[0].split(",").map(s => s.trim());
  const lower = firstCols.map(s => s.toLowerCase());
  let startIdx = 0, walletIdx = 0, codeIdx = 1;

  const hasHeader = ["wallet_address","referral_code"]
    .some(h => lower.includes(h));

  if (hasHeader) {
    walletIdx = lower.findIndex(h => ["wallet_address"].includes(h));
    codeIdx   = lower.findIndex(h => ["referral_code"].includes(h));
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

/**
 * @notice purchase_history.csv 파일을 파싱하여 구매 정보를 추출
 * @param csvText CSV 파일의 텍스트 내용
 * @returns {wallet: string, ref: string, amount: string, price: string, time: string}[] 형태의 구매 정보 배열
 * @description 
 * - 필드: wallet/address, referral/refcode/code(옵션), amount/qty/box(_count), avg_price/unit_price, create_at/created_at/timestamp
 * - 헤더가 있는 경우 자동으로 인식하여 필요한 컬럼들 찾기
 * - 헤더가 없는 경우 기본 컬럼 순서 사용
 * - 필수 컬럼(wallet, amount, price, time)이 없으면 해당 행은 건너뛰기
 */
function parsePurchasesCsv(csvText) {
  const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  const firstCols = lines[0].split(",").map(s => s.trim());
  const lower = firstCols.map(s => s.toLowerCase());
  let startIdx = 0;

  const headerMap = {
    wallet: lower.findIndex(h => ["wallet_address"].includes(h)),
    ref:    lower.findIndex(h => ["referral"].includes(h)),
    amount: lower.findIndex(h => ["amount"].includes(h)),
    price:  lower.findIndex(h => ["avg_price"].includes(h)),
    time:   lower.findIndex(h => ["created_at"].includes(h)),
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

/**
 * @notice 레퍼럴 코드를 정규화하고 유효성 검증 (빈 값 허용)
 * @param code 원본 레퍼럴 코드
 * @returns 정규화된 8자리 대문자 코드 또는 빈 문자열
 * @throws 유효하지 않은 코드 형식이면 에러 발생
 * @description 
 * - 빈 값이면 빈 문자열 그대로 반환 (레퍼럴 없는 구매 허용)
 * - 8자리 A-Z, 0-9 조합만 허용
 * - 대문자로 정규화
 */
function normalizeCodeMaybeEmpty(code) {
  const c = String(code || "").trim();
  if (c === "") return "";
  const up = c.toUpperCase();
  if (!/^[A-Z0-9]{8}$/.test(up)) {
    throw new Error(`잘못된 referral 코드 형식: ${code}`);
  }
  return up;
}

/**
 * @notice USDT 6자리 소수점 금액을 파싱하여 최소 단위로 변환
 * @param val USDT 금액 문자열 (예: "12.3456", "100")
 * @returns BigInt 형태의 최소 단위 금액 (6자리 소수점 기준)
 * @description 
 * - 6 decimals로 파싱 (예: "12.3456" → 12345600)
 * - 정수: "100" → 100000000 (100 USDT)
 * - 소수: "12.3456" → 12345600 (12.3456 USDT)
 * - 소수>6자리면 내림(floor) 처리
 */
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

/**
 * @notice 박스 수량을 파싱하여 BigInt로 변환
 * @param val 박스 수량 문자열
 * @returns BigInt 형태의 박스 수량
 * @throws 숫자가 아닌 값이면 에러 발생
 * @description 
 * - amount(정수 박스 수) 파싱
 * - 정수만 허용 (소수점 불가)
 */
function parseBoxCount(val) {
  const s = String(val).trim();
  if (!/^\d+$/.test(s)) throw new Error(`amount(정수 박스 수) 파싱 실패: ${val}`);
  return BigInt(s);
}

/**
 * @notice 다양한 형식의 날짜/시간을 Unix timestamp(초)로 변환
 * @param val 날짜/시간 문자열
 * @returns BigInt 형태의 Unix timestamp (초)
 * @description 
 * - create_at → epoch seconds(BigInt)
 * - 10자리 timestamp: "1234567890" → 1234567890n
 * - 13자리 timestamp: "1234567890123" → 1234567890n (밀리초 → 초 변환)
 * - "YYYY-MM-DD HH:mm:ss"이면 UTC 가정으로 'Z' 붙여 파싱
 * - timezone 표기 없으면 UTC 가정
 */
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

/**
 * @describe CSV 파일을 통한 구매 이력 백필 및 검증 테스트
 * @description 
 * 1. user.csv에서 사용자 정보와 레퍼럴 코드를 읽어와서 설정
 * 2. purchase_history.csv에서 구매 이력을 읽어와서 backfillPurchaseAt으로 백필
 * 3. 백필된 데이터가 on-chain 상태와 일치하는지 검증
 */
describe("vesting.backfill.fromcsv", function () {
  /**
   * @test user.csv로 코드 세팅 후, purchase_history.csv 전체 백필
   * @description 
   * - CSV 데이터를 기반으로 실제 구매 이력을 시뮬레이션
   * - 백필된 데이터의 정확성 검증
   * - 일자별 누적 데이터와 on-chain 상태 비교
   */
  it("user.csv로 코드 세팅 후, purchase_history.csv 전체 백필", async () => {
    const { owner, vesting, start } = await deployFixture();

    // 1) user.csv 로드 → setReferralCodesBulk
    // CSV 파일에서 사용자 정보를 읽어와서 레퍼럴 코드를 일괄 설정
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

    // setReferralCodesBulk 함수가 있으면 일괄 설정, 없으면 개별 설정
    if (typeof vesting.setReferralCodesBulk === "function") {
      await vesting.connect(owner).setReferralCodesBulk(users, codes, true);
    } else {
      for (let i = 0; i < users.length; i++) {
        await vesting.connect(owner).setReferralCode(users[i], codes[i], true);
      }
    }

    // 2) purchase_history.csv 로드 → 각 행 백필
    // CSV 파일에서 구매 이력을 읽어와서 backfillPurchaseAt으로 백필
    const purchaseCsv = findCsvText([path.join(__dirname, "../test/data", "purchase_history.csv")]);
    const rows = parsePurchasesCsv(purchaseCsv);
    expect(rows.length).to.be.greaterThan(0);

    // 일자별 누적 검증 맵들
    // CSV 데이터를 기반으로 예상되는 on-chain 상태를 미리 계산
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

      // day 인덱스 계산: 베스팅 시작일 기준 경과 일수
      const startBn = start;
      const d = purchaseTs < startBn ? 0n : (purchaseTs - startBn) / 86400n;
      allDays.add(d);

      // 누적 합산: 예상되는 on-chain 상태 미리 계산
      dayTotals.set(d, (dayTotals.get(d) || 0n) + boxCount);
      if (refCodeStr !== "") {
        refDayTotals.set(d, (refDayTotals.get(d) || 0n) + boxCount);
      }

      // 백필 실행 (관리자): 실제 on-chain에 구매 이력 추가
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
    // CSV 데이터 기반 예상값과 on-chain 상태를 비교하여 백필이 정확하게 되었는지 검증
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