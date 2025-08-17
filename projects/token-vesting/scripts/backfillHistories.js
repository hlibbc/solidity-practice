// scripts/backfillHistories.js
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { ethers } = hre;

// ───────────────────────────── util ─────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitIfNeeded() {
  if (["localhost", "hardhat", "development"].includes(hre.network.name)) {
    await sleep(1000);
  }
}
function mustRead(p) {
  if (!fs.existsSync(p)) throw new Error(`CSV not found: ${p}`);
  return fs.readFileSync(p, "utf8");
}

// 정규화/파서들 (테스트 코드와 동일한 규칙)
function normCodeMaybeEmpty(code) {
  const c = String(code || "").trim();
  if (!c) return "";
  const up = c.toUpperCase();
  if (!/^[A-Z0-9]{8}$/.test(up)) throw new Error(`Invalid referral code: ${code}`);
  return up;
}
function parseBoxCount(v) {
  const s = String(v).trim();
  if (!/^\d+$/.test(s)) throw new Error(`Invalid amount: ${v}`);
  return BigInt(s);
}
function parseUsdt6(v) {
  const s = String(v).trim();
  if (/^\d+$/.test(s)) return BigInt(s) * 10n ** 6n;
  const [L, R = ""] = s.split(".");
  const left = (L || "0").replace(/[^\d]/g, "");
  const right = (R.replace(/[^\d]/g, "") + "000000").slice(0, 6);
  return BigInt(left || "0") * 10n ** 6n + BigInt(right || "0");
}
function parseEpochSec(v) {
  const t = String(v).trim();
  if (/^\d{10}$/.test(t)) return BigInt(t);
  if (/^\d{13}$/.test(t)) return BigInt(t) / 1000n;
  let iso = t;
  if (!/[zZ]|[+\-]\d{2}:?\d{2}/.test(t)) iso = t.replace(" ", "T") + "Z"; // TZ없으면 UTC로 가정
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new Error(`Bad datetime: ${v}`);
  return BigInt(Math.floor(ms / 1000));
}

// ───────────────────────────── CSV parsers ─────────────────────────────
// user.csv: 권장 헤더 wallet_address, referral_code (무헤더면 [wallet, code])
function parseUsersCsv(csvText) {
  const lines = csvText.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (!lines.length) return [];
  const header = lines[0].split(",").map(s => s.trim().toLowerCase());
  let start = 0, w = 0, c = 1;
  const hasHeader = ["wallet_address", "referral_code"].some(h => header.includes(h));
  if (hasHeader) {
    w = header.findIndex(h => ["wallet_address"].includes(h));
    c = header.findIndex(h => ["referral_code"].includes(h));
    if (w < 0 || c < 0) throw new Error("user.csv header not recognized (wallet_address/referral_code)");
    start = 1;
  }
  const rows = [];
  for (let i = start; i < lines.length; i++) {
    const cols = lines[i].split(",").map(s => s.trim());
    const wallet = cols[w], code = cols[c];
    if (wallet && code) rows.push({ wallet, code });
  }
  return rows;
}

// purchase_history.csv: 권장 헤더 wallet_address, referral, amount, avg_price, updated_at
// 무헤더면 [wallet, referral, amount, price, time]
function parsePurchasesCsv(csvText) {
  const lines = csvText.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (!lines.length) return [];
  const header = lines[0].split(",").map(s => s.trim().toLowerCase());
  let start = 0;
  const idx = {
    wallet: header.findIndex(h => ["wallet_address"].includes(h)),
    ref:    header.findIndex(h => ["referral"].includes(h)),
    amount: header.findIndex(h => ["amount"].includes(h)),
    price:  header.findIndex(h => ["avg_price"].includes(h)),
    time:   header.findIndex(h => ["updated_at"].includes(h)),
  };
  const hasHeader = Object.values(idx).some(i => i !== -1);
  if (hasHeader) {
    if (idx.wallet < 0 || idx.amount < 0 || idx.price < 0 || idx.time < 0) {
      throw new Error("purchase_history.csv header not recognized (wallet_address/amount/avg_price/updated_at)");
    }
    start = 1;
  } else {
    idx.wallet = 0; idx.ref = 1; idx.amount = 2; idx.price = 3; idx.time = 4;
  }
  const rows = [];
  for (let i = start; i < lines.length; i++) {
    const cols = lines[i].split(",").map(s => s.trim());
    const g = k => (idx[k] >= 0 && idx[k] < cols.length) ? cols[idx[k]] : "";
    const wallet = g("wallet"), ref = g("ref"), amount = g("amount"), price = g("price"), time = g("time");
    if (wallet && amount && price && time) rows.push({ wallet, ref, amount, price, time });
  }
  return rows;
}

// ───────────────────────────── main ─────────────────────────────
async function main() {
  console.log("🚀 backfillHistories 시작");
  const ownerKey = process.env.OWNER_KEY;
  const providerUrl = process.env.PROVIDER_URL || "http://127.0.0.1:8545";
  if (!ownerKey) throw new Error("❌ .env의 OWNER_KEY가 필요합니다.");

  const provider = new ethers.JsonRpcProvider(providerUrl);
  const wallet = new ethers.Wallet(ownerKey, provider);
  console.log("🌐 네트워크:", hre.network.name);
  console.log("👤 실행 계정:", wallet.address);

  // 배포 정보 읽기
  const outPath = path.join(__dirname, "output", "deployment-info.json");
  if (!fs.existsSync(outPath)) throw new Error(`❌ 파일 없음: ${outPath}`);
  const info = JSON.parse(fs.readFileSync(outPath, "utf8"));
  const vestingAddr =
    info.tokenVesting || info.contracts?.tokenVesting || info.contracts?.vesting || info.vesting;
  if (!vestingAddr) throw new Error("❌ deployment-info.json에 TokenVesting 주소가 없습니다.");

  const vesting = await ethers.getContractAt("TokenVesting", vestingAddr, wallet);
  console.log("🔗 TokenVesting:", vestingAddr);

  // CSV 로드
  const userCsvPath = path.join(__dirname, "data", "user.csv");
  const purchCsvPath = path.join(__dirname, "data", "purchase_history.csv");
  const userRows = parseUsersCsv(mustRead(userCsvPath));
  const purchRows = parsePurchasesCsv(mustRead(purchCsvPath));
  console.log(`📦 user.csv rows: ${userRows.length}`);
  console.log(`📦 purchase_history.csv rows: ${purchRows.length}`);

  // 1) 레퍼럴 코드 세팅 (bulk, overwrite=true 권장 이관)
  if (userRows.length) {
    console.log("\n1️⃣ setReferralCodesBulk...");
    const BATCH = 150;
    let done = 0;
    while (done < userRows.length) {
      const slice = userRows.slice(done, done + BATCH);
      const addrs = slice.map(r => ethers.getAddress(r.wallet));
      const codes = slice.map(r => {
        const n = normCodeMaybeEmpty(r.code);
        if (!n) throw new Error(`Empty code for ${r.wallet}`);
        return n;
      });
      const tx = await vesting.setReferralCodesBulk(addrs, codes, true);
      await tx.wait();
      console.log(`  • ${done}..${done + slice.length - 1} ok (tx: ${tx.hash})`);
      done += slice.length;
      await waitIfNeeded();
    }
    console.log("✅ referral codes done");
  } else {
    console.log("\n1️⃣ setReferralCodesBulk: rows=0 (skip)");
  }

  // 2) 구매 이력 백필 (paidUnits=amount*avg_price(6dec), creditBuyback=true)
  if (purchRows.length) {
    console.log("\n2️⃣ backfillPurchaseAt...");
    let ok = 0, fail = 0;
    for (let i = 0; i < purchRows.length; i++) {
      const r = purchRows[i];
      try {
        const buyer = ethers.getAddress(r.wallet);
        const refCodeStr = normCodeMaybeEmpty(r.ref);   // "" 허용
        const boxCount = parseBoxCount(r.amount);
        const paidUnits = parseUsdt6(r.price) * boxCount;
        const purchaseTs = parseEpochSec(r.time);

        const tx = await vesting.backfillPurchaseAt(
          buyer,
          refCodeStr,
          boxCount,
          purchaseTs,
          paidUnits,
          true // creditBuyback
        );
        await tx.wait();
        ok++;
        if (ok % 50 === 0) console.log(`  • 진행: ${ok} 성공 / ${fail} 실패`);
        await waitIfNeeded();
      } catch (e) {
        fail++;
        console.warn(`  × row#${i} 실패:`, e.shortMessage || e.message || e);
      }
    }
    console.log(`✅ backfill done — 성공 ${ok} / 실패 ${fail}`);
  } else {
    console.log("\n2️⃣ backfillPurchaseAt: rows=0 (skip)");
  }

  console.log("\n🎉 backfillHistories 완료!");
}

// run
main().then(() => process.exit(0)).catch((err) => {
  console.error("❌ 스크립트 오류:", err);
  process.exit(1);
});
