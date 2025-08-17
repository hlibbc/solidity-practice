// test/vesting.referral.bulkcsv.test.js
const { expect } = require("chai");
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
const { deployFixture } = require("./helpers/vestingFixture");

function findCsvText() {
  const candidates = [path.join(__dirname, "../test/data", "user.csv"),].filter(Boolean);

  for (const p of candidates) {
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
  }
  throw new Error(
    `CSV 파일을 찾을 수 없습니다. 경로 후보: \n${candidates.join("\n")}\n` +
    `예시 포맷: "wallet,address,referral_code" 또는 "wallet_address,referral_code" 또는 두 컬럼 무헤더`
  );
}

function parseCsvRows(csv) {
  const lines = csv.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  // 헤더 감지
  const firstCols = lines[0].split(",").map(s => s.trim().toLowerCase());
  let startIdx = 0;
  let walletIdx = -1, codeIdx = -1;

  const headerMatches =
    firstCols.includes("wallet") || firstCols.includes("address") ||
    firstCols.includes("wallet_address") || firstCols.includes("referral_code") ||
    firstCols.includes("refcode") || firstCols.includes("code");

  if (headerMatches) {
    walletIdx = firstCols.findIndex(h => ["wallet_address"].includes(h));
    codeIdx   = firstCols.findIndex(h => ["referral_code"].includes(h));
    startIdx = 1;
  }

  const rows = [];
  for (let i = startIdx; i < lines.length; i++) {
    const cols = lines[i].split(",").map(s => s.trim());
    if (cols.length < 2) continue;

    let wallet = walletIdx >= 0 ? cols[walletIdx] : cols[0];
    let code   = codeIdx   >= 0 ? cols[codeIdx]   : cols[1];

    if (!wallet || !code) continue;
    rows.push({ wallet, code });
  }
  return rows;
}

function normalizeCode(code) {
  const c = String(code).trim().toUpperCase();
  if (!/^[A-Z0-9]{8}$/.test(c)) {
    throw new Error(`잘못된 코드 형식: ${code}`);
  }
  return c;
}

function codeToBytes8(code) {
  const bytes = ethers.toUtf8Bytes(code);
  if (bytes.length !== 8) throw new Error(`코드 길이(8)가 아님: ${code}`);
  return ethers.hexlify(bytes); // bytes8에 대응되는 0x헥스(8 bytes)
}

describe("vesting.referral.bulkcsv", function () {
  it("CSV를 읽어 setReferralCodesBulk로 설정하고, 매핑/뷰로 검증", async () => {
    const { owner, vesting } = await deployFixture();

    // 1) CSV 로드 & 파싱
    const csv = findCsvText();
    const rawRows = parseCsvRows(csv);
    expect(rawRows.length).to.be.greaterThan(0, "CSV 행이 없습니다.");

    // 2) 주소/코드 정규화 + 배열 생성
    const users = [];
    const codes = [];
    for (const { wallet, code } of rawRows) {
      const addr = ethers.getAddress(wallet);     // checksum
      const norm = normalizeCode(code);           // A-Z0-9 8자
      users.push(addr);
      codes.push(norm);
    }

    // 3) bulk 세팅 (overwrite = true 권장: 기존 코드가 있어도 덮어쓰기)
    await expect(
      vesting.connect(owner).setReferralCodesBulk(users, codes, true)
    ).to.emit(vesting, "ReferralCodeAssigned"); // 여러 번 발생 가능

    // 4) 검증: myReferralCodeString / referralCodeOf / codeToOwner
    for (let i = 0; i < users.length; i++) {
      const addr = users[i];
      const code = codes[i];                // normalized

      // 문자열 뷰 확인
      const s = await vesting.myReferralCodeString(addr);
      expect(s).to.equal(code);

      // 매핑: referralCodeOf(addr) == bytes8(code)
      const b8 = codeToBytes8(code);
      const savedB8 = await vesting.referralCodeOf(addr);
      expect(savedB8).to.equal(b8);

      // 역매핑: codeToOwner(bytes8(code)) == addr
      const ownerOf = await vesting.codeToOwner(b8);
      expect(ownerOf).to.equal(addr);
    }
  });
});
