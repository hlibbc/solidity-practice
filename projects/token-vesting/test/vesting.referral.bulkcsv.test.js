// test/vesting.referral.bulkcsv.test.js
/**
 * @fileoverview 
 *  CSV 파일을 통한 레퍼럴 코드 일괄 설정 테스트
 * @description
 *  - CSV 파일에서 사용자 정보를 읽어와서
 *  - setReferralCodesBulk 함수로 레퍼럴 코드를 일괄 설정하고
 *  - 설정된 매핑과 뷰 함수들이 올바르게 작동하는지 검증
 * 
 * 테스트 목적:
 *  - CSV 데이터를 통한 대량 레퍼럴 코드 설정 기능 검증
 *  - setReferralCodesBulk 함수의 정상 동작 확인
 *  - 양방향 매핑(주소↔코드)의 정확성 검증
 *  - 뷰 함수들의 올바른 반환값 확인
 * 
 * CSV 형식 지원:
 *  - 헤더가 있는 경우: wallet/address/wallet_address, referral_code/refcode/code 컬럼 자동 인식
 *  - 헤더가 없는 경우: 첫 번째 컬럼(지갑 주소), 두 번째 컬럼(레퍼럴 코드)
 *  - 다양한 컬럼명에 대응하여 유연한 데이터 처리
 * 
 * @author hlibbc
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
const { deployFixture } = require("./helpers/vestingFixture");

// =============================================================================
// CSV 파일 처리 유틸리티 함수들
// =============================================================================

/**
 * @notice CSV 파일을 찾아서 내용을 읽어오는 함수
 * @returns {string} CSV 파일의 텍스트 내용
 * @throws {Error} CSV 파일을 찾을 수 없으면 에러 발생
 * @description 
 *  - 여러 경로 후보에서 CSV 파일을 찾아서 읽기
 *  - 현재는 user.csv만 지원
 *  - 파일이 없으면 에러 메시지와 함께 예시 포맷 안내
 * 
 * 지원 경로:
 *  - ../test/data/user.csv
 * 
 * 에러 처리:
 *  - 파일이 존재하지 않을 때 상세한 에러 메시지와 예시 포맷 제공
 *  - 개발자가 CSV 파일을 올바르게 준비할 수 있도록 가이드
 */
function findCsvText() {
    const candidates = [
        path.join(__dirname, "../test/data", "user.csv"),
    ].filter(Boolean);

    // === 여러 경로 후보에서 CSV 파일 찾기 ===
    for (const p of candidates) {
        if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
    }
    
    // === CSV 파일을 찾을 수 없을 때 상세한 에러 메시지 제공 ===
    throw new Error(
        `CSV 파일을 찾을 수 없습니다. 경로 후보: \n${candidates.join("\n")}\n` +
        `예시 포맷: "wallet,address,referral_code" 또는 "wallet_address,referral_code" 또는 두 컬럼 무헤더`
    );
}

/**
 * @notice CSV 텍스트를 파싱하여 사용자 정보 배열로 변환
 * @param {string} csv - CSV 파일의 텍스트 내용
 * @returns {Array<{wallet: string, code: string}>} 사용자 정보 배열
 * @description 
 *  - 헤더가 있는 경우 자동으로 인식하여 wallet과 referral_code 컬럼 찾기
 *  - 헤더가 없는 경우 기본 컬럼 순서(0: wallet, 1: code) 사용
 *  - 다양한 컬럼명에 대응 (wallet/address/wallet_address, referral_code/refcode/code)
 *  - 빈 행이나 유효하지 않은 행은 자동으로 필터링
 * 
 * 파싱 로직:
 *  1. 줄바꿈 문자로 행 분리 및 공백 제거
 *  2. 헤더 존재 여부 자동 감지
 *  3. 컬럼 인덱스 자동 매핑
 *  4. 유효한 데이터만 필터링하여 반환
 * 
 * 지원 컬럼명:
 *  - 지갑 주소: wallet, address, wallet_address
 *  - 레퍼럴 코드: referral_code, refcode, code
 */
function parseCsvRows(csv) {
    // === CSV 텍스트를 행 단위로 분리 및 정리 ===
    const lines = csv.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return [];

    // === 헤더 감지 및 컬럼 인덱스 매핑 ===
    const firstCols = lines[0].split(",").map(s => s.trim().toLowerCase());
    let startIdx = 0;
    let walletIdx = -1, codeIdx = -1;

    // 헤더가 있는지 확인 (지갑 주소나 레퍼럴 코드 관련 컬럼명이 포함되어 있는지)
    const headerMatches =
        firstCols.includes("wallet") || firstCols.includes("address") ||
        firstCols.includes("wallet_address") || firstCols.includes("referral_code") ||
        firstCols.includes("refcode") || firstCols.includes("code");

    if (headerMatches) {
        // === 헤더가 있는 경우 컬럼 인덱스 자동 찾기 ===
        walletIdx = firstCols.findIndex(h => ["wallet_address"].includes(h));
        codeIdx = firstCols.findIndex(h => ["referral_code"].includes(h));
        startIdx = 1; // 헤더 다음 행부터 데이터 처리
    }

    // === 각 행을 파싱하여 사용자 정보 배열 생성 ===
    const rows = [];
    for (let i = startIdx; i < lines.length; i++) {
        const cols = lines[i].split(",").map(s => s.trim());
        if (cols.length < 2) continue; // 최소 2개 컬럼 필요

        // === 컬럼 인덱스에 따라 지갑 주소와 레퍼럴 코드 추출 ===
        let wallet = walletIdx >= 0 ? cols[walletIdx] : cols[0];
        let code = codeIdx >= 0 ? cols[codeIdx] : cols[1];

        // === 유효한 데이터만 필터링 ===
        if (!wallet || !code) continue;
        rows.push({ wallet, code });
    }
    return rows;
}

// =============================================================================
// 레퍼럴 코드 정규화 및 변환 함수들
// =============================================================================

/**
 * @notice 레퍼럴 코드를 정규화하고 유효성 검증
 * @param {string} code - 원본 레퍼럴 코드
 * @returns {string} 정규화된 8자리 대문자 코드
 * @throws {Error} 유효하지 않은 코드 형식이면 에러 발생
 * @description 
 *  - 공백 제거 후 대문자로 변환
 *  - 8자리 A-Z, 0-9 조합만 허용
 *  - 정규식으로 형식 검증
 * 
 * 정규화 규칙:
 *  - 앞뒤 공백 제거
 *  - 모든 문자를 대문자로 변환
 *  - 8자리 길이 검증
 *  - A-Z, 0-9 문자만 허용
 * 
 * 에러 처리:
 *  - 형식이 맞지 않으면 상세한 에러 메시지와 함께 예외 발생
 *  - 개발자가 코드 형식을 올바르게 수정할 수 있도록 가이드
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
 * @param {string} code - 정규화된 8자리 레퍼럴 코드
 * @returns {string} bytes8에 대응되는 0x 헥스 문자열
 * @throws {Error} 코드 길이가 8자리가 아니면 에러 발생
 * @description 
 *  - UTF-8 바이트로 변환하여 bytes8 형태 생성
 *  - Solidity의 bytes8 타입과 호환되는 형태로 반환
 *  - 0x 접두사가 포함된 헥스 문자열 형태
 * 
 * 변환 과정:
 *  1. 문자열을 UTF-8 바이트 배열로 변환
 *  2. 바이트 길이가 8인지 검증
 *  3. 0x 접두사가 포함된 헥스 문자열로 변환
 * 
 * Solidity 호환성:
 *  - bytes8 타입과 직접 매핑 가능
 *  - 컨트랙트 함수 호출 시 사용 가능
 */
function codeToBytes8(code) {
    const bytes = ethers.toUtf8Bytes(code);
    if (bytes.length !== 8) throw new Error(`코드 길이(8)가 아님: ${code}`);
    return ethers.hexlify(bytes); // bytes8에 대응되는 0x헥스(8 bytes)
}

// =============================================================================
// CSV를 통한 레퍼럴 코드 일괄 설정 및 검증 테스트
// =============================================================================

/**
 * @describe CSV를 통한 레퍼럴 코드 일괄 설정 및 검증 테스트
 * @description 
 *  1. CSV 파일에서 사용자 정보를 읽어와서 파싱
 *  2. 주소와 코드를 정규화하여 배열 생성
 *  3. setReferralCodesBulk로 일괄 설정
 *  4. 설정된 매핑과 뷰 함수들이 올바르게 작동하는지 검증
 * 
 * 테스트 시나리오:
 *  - CSV 데이터 로드 및 파싱
 *  - 주소와 레퍼럴 코드 정규화
 *  - 일괄 설정 함수 호출
 *  - 양방향 매핑 검증
 *  - 뷰 함수 정확성 검증
 * 
 * 검증 항목:
 *  - getReferralCode: 주소로 레퍼럴 코드 조회
 *  - referralCodeOf: 주소로 bytes8 형태의 레퍼럴 코드 조회
 *  - codeToOwner: 레퍼럴 코드로 소유자 주소 조회
 */
describe("vesting.referral.bulkcsv", function () {
    /**
     * @test CSV를 읽어 setReferralCodesBulk로 설정하고, 매핑/뷰로 검증
     * @description 
     *  - CSV 데이터를 기반으로 레퍼럴 코드를 일괄 설정
     *  - 설정 완료 후 양방향 매핑 검증
     *  - 뷰 함수들이 올바른 값을 반환하는지 확인
     * 
     * 테스트 단계:
     *  1. CSV 로드 및 파싱
     *  2. 주소/코드 정규화 및 배열 생성
     *  3. 일괄 설정 함수 호출
     *  4. 양방향 매핑 및 뷰 함수 검증
     * 
     * 검증 포인트:
     *  - CSV 데이터가 올바르게 파싱되는지
     *  - 일괄 설정이 성공적으로 완료되는지
     *  - 이벤트가 올바르게 발생하는지
     *  - 모든 매핑이 정확하게 설정되는지
     *  - 뷰 함수들이 올바른 값을 반환하는지
     */
    it("CSV를 읽어 setReferralCodesBulk로 설정하고, 매핑/뷰로 검증", async () => {
        // === 테스트 환경 구성 ===
        const { owner, vesting } = await deployFixture();

        // === 1) CSV 로드 & 파싱 ===
        // CSV 파일을 찾아서 읽고, 사용자 정보를 파싱하여 배열로 변환
        const csv = findCsvText();
        const rawRows = parseCsvRows(csv);
        expect(rawRows.length).to.be.greaterThan(0, "CSV 행이 없습니다.");

        // === 2) 주소/코드 정규화 + 배열 생성 ===
        // 각 행의 지갑 주소와 레퍼럴 코드를 정규화하여 배열 생성
        const users = [];
        const codes = [];
        for (const { wallet, code } of rawRows) {
            const addr = ethers.getAddress(wallet);     // checksum 주소로 정규화
            const norm = normalizeCode(code);           // A-Z0-9 8자로 정규화
            users.push(addr);
            codes.push(norm);
        }

        // === 3) bulk 세팅 (overwrite = true 권장: 기존 코드가 있어도 덮어쓰기) ===
        // setReferralCodesBulk 함수를 호출하여 모든 사용자의 레퍼럴 코드를 한 번에 설정
        await expect(
            vesting.connect(owner).setReferralCodesBulk(users, codes, true)
        ).to.emit(vesting, "ReferralCodeAssigned"); // 여러 번 발생 가능 (사용자 수만큼)

        // === 4) 검증: getReferralCode / referralCodeOf / codeToOwner ===
        // 설정된 모든 사용자에 대해 양방향 매핑과 뷰 함수 검증
        for (let i = 0; i < users.length; i++) {
            const addr = users[i];
            const code = codes[i];                // normalized

            // === 문자열 뷰 확인: getReferralCode 함수가 올바른 코드 반환 ===
            const s = await vesting.getReferralCode(addr);
            expect(s).to.equal(code);

            // === 매핑 검증: referralCodeOf(addr) == bytes8(code) ===
            // 사용자 주소로 저장된 bytes8 형태의 레퍼럴 코드 확인
            const b8 = codeToBytes8(code);
            const savedB8 = await vesting.referralCodeOf(addr);
            expect(savedB8).to.equal(b8);

            // === 역매핑 검증: codeToOwner(bytes8(code)) == addr ===
            // 레퍼럴 코드로 소유자 주소를 조회하여 일치하는지 확인
            const ownerOf = await vesting.codeToOwner(b8);
            expect(ownerOf).to.equal(addr);
        }
    });
});
