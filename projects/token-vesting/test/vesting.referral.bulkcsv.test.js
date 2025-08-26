// test/vesting.referral.bulkcsv.test.js
/**
 * @fileoverview CSV 파일을 통한 레퍼럴 코드 일괄 설정 테스트
 * @description 
 * - CSV 파일에서 사용자 정보를 읽어와서
 * - setReferralCodesBulk 함수로 레퍼럴 코드를 일괄 설정하고
 * - 설정된 매핑과 뷰 함수들이 올바르게 작동하는지 검증
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
const { deployFixture } = require("./helpers/vestingFixture");

/**
 * @notice CSV 파일을 찾아서 내용을 읽어오는 함수
 * @returns CSV 파일의 텍스트 내용
 * @throws CSV 파일을 찾을 수 없으면 에러 발생
 * @description 
 * - 여러 경로 후보에서 CSV 파일을 찾아서 읽기
 * - 현재는 user.csv만 지원
 * - 파일이 없으면 에러 메시지와 함께 예시 포맷 안내
 */
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

/**
 * @notice CSV 텍스트를 파싱하여 사용자 정보 배열로 변환
 * @param csv CSV 파일의 텍스트 내용
 * @returns {wallet: string, code: string}[] 형태의 사용자 정보 배열
 * @description 
 * - 헤더가 있는 경우 자동으로 인식하여 wallet과 referral_code 컬럼 찾기
 * - 헤더가 없는 경우 기본 컬럼 순서(0: wallet, 1: code) 사용
 * - 다양한 컬럼명에 대응 (wallet/address/wallet_address, referral_code/refcode/code)
 * - 빈 행이나 유효하지 않은 행은 자동으로 필터링
 */
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

/**
 * @notice 레퍼럴 코드를 정규화하고 유효성 검증
 * @param code 원본 레퍼럴 코드
 * @returns 정규화된 8자리 대문자 코드
 * @throws 유효하지 않은 코드 형식이면 에러 발생
 * @description 
 * - 공백 제거 후 대문자로 변환
 * - 8자리 A-Z, 0-9 조합만 허용
 * - 정규식으로 형식 검증
 */
function normalizeCode(code) {
  const c = String(code).trim().toUpperCase();
  if (!/^[A-Z0-9]{8}$/.test(c)) {
    throw new Error(`잘못된 코드 형식: ${code}`);
  }
  return c;
}

/**
 * @notice 정규화된 레퍼럴 코드를 bytes8 형태로 변환
 * @param code 정규화된 8자리 레퍼럴 코드
 * @returns bytes8에 대응되는 0x 헥스 문자열
 * @throws 코드 길이가 8자리가 아니면 에러 발생
 * @description 
 * - UTF-8 바이트로 변환하여 bytes8 형태 생성
 * - Solidity의 bytes8 타입과 호환되는 형태로 반환
 * - 0x 접두사가 포함된 헥스 문자열 형태
 */
function codeToBytes8(code) {
  const bytes = ethers.toUtf8Bytes(code);
  if (bytes.length !== 8) throw new Error(`코드 길이(8)가 아님: ${code}`);
  return ethers.hexlify(bytes); // bytes8에 대응되는 0x헥스(8 bytes)
}

/**
 * @describe CSV를 통한 레퍼럴 코드 일괄 설정 및 검증 테스트
 * @description 
 * 1. CSV 파일에서 사용자 정보를 읽어와서 파싱
 * 2. 주소와 코드를 정규화하여 배열 생성
 * 3. setReferralCodesBulk로 일괄 설정
 * 4. 설정된 매핑과 뷰 함수들이 올바르게 작동하는지 검증
 */
describe("vesting.referral.bulkcsv", function () {
  /**
   * @test CSV를 읽어 setReferralCodesBulk로 설정하고, 매핑/뷰로 검증
   * @description 
   * - CSV 데이터를 기반으로 레퍼럴 코드를 일괄 설정
   * - 설정 완료 후 양방향 매핑 검증
   * - 뷰 함수들이 올바른 값을 반환하는지 확인
   */
  it("CSV를 읽어 setReferralCodesBulk로 설정하고, 매핑/뷰로 검증", async () => {
    const { owner, vesting } = await deployFixture();

    // 1) CSV 로드 & 파싱
    // CSV 파일을 찾아서 읽고, 사용자 정보를 파싱하여 배열로 변환
    const csv = findCsvText();
    const rawRows = parseCsvRows(csv);
    expect(rawRows.length).to.be.greaterThan(0, "CSV 행이 없습니다.");

    // 2) 주소/코드 정규화 + 배열 생성
    // 각 행의 지갑 주소와 레퍼럴 코드를 정규화하여 배열 생성
    const users = [];
    const codes = [];
    for (const { wallet, code } of rawRows) {
      const addr = ethers.getAddress(wallet);     // checksum 주소로 정규화
      const norm = normalizeCode(code);           // A-Z0-9 8자로 정규화
      users.push(addr);
      codes.push(norm);
    }

    // 3) bulk 세팅 (overwrite = true 권장: 기존 코드가 있어도 덮어쓰기)
    // setReferralCodesBulk 함수를 호출하여 모든 사용자의 레퍼럴 코드를 한 번에 설정
    await expect(
      vesting.connect(owner).setReferralCodesBulk(users, codes, true)
    ).to.emit(vesting, "ReferralCodeAssigned"); // 여러 번 발생 가능 (사용자 수만큼)

    // 4) 검증: getReferralCode / referralCodeOf / codeToOwner
    // 설정된 모든 사용자에 대해 양방향 매핑과 뷰 함수 검증
    for (let i = 0; i < users.length; i++) {
      const addr = users[i];
      const code = codes[i];                // normalized

      // 문자열 뷰 확인: getReferralCode 함수가 올바른 코드 반환
      const s = await vesting.getReferralCode(addr);
      expect(s).to.equal(code);

      // 매핑 검증: referralCodeOf(addr) == bytes8(code)
      // 사용자 주소로 저장된 bytes8 형태의 레퍼럴 코드 확인
      const b8 = codeToBytes8(code);
      const savedB8 = await vesting.referralCodeOf(addr);
      expect(savedB8).to.equal(b8);

      // 역매핑 검증: codeToOwner(bytes8(code)) == addr
      // 레퍼럴 코드로 소유자 주소를 조회하여 일치하는지 확인
      const ownerOf = await vesting.codeToOwner(b8);
      expect(ownerOf).to.equal(addr);
    }
  });
});
