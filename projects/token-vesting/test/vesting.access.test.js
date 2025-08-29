// test/vesting.access.test.js
/**
 * @fileoverview 
 *  TokenVesting 컨트랙트의 접근 제어(onlyOwner) 기능 테스트
 * @description 
 *  - 관리자 전용 함수들의 onlyOwner 보호 기능 검증
 *  - 일반 사용자가 관리자 함수 호출 시도 시 에러 발생 확인
 *  - OwnableUnauthorizedAccount 커스텀 에러 메시지 검증
 * 
 * 테스트 대상 함수들:
 *   - initializeSchedule: 베스팅 스케줄 초기화
 *   - setVestingToken: 베스팅 토큰 주소 설정
 *   - backfillPurchaseAt: 과거 구매 데이터 백필
 *   - syncLimitDay: 제한된 일수로 동기화
 * 
 * @author hlibbc
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployFixture } = require("./helpers/vestingFixture");

// =============================================================================
// 베스팅 컨트랙트 접근 제어 테스트 스위트
// =============================================================================

/**
 * @describe 베스팅 컨트랙트의 접근 제어 기능 테스트
 * @description 
 *  - onlyOwner로 보호된 관리자 전용 함수들의 접근 제어 검증
 *  - 일반 사용자(buyer)가 관리자 함수를 호출할 때 적절한 에러 발생 확인
 *  - 각 함수별로 OwnableUnauthorizedAccount 커스텀 에러와 호출자 주소 검증
 */
describe("vesting.access", function () {

    // =============================================================================
    // onlyOwner 보호 기능 테스트
    // =============================================================================

    /**
     * @test onlyOwner 보호: backfill/initialize/setVestingToken/syncLimitDay
     * @description 
     *  - 관리자 전용 함수들을 일반 사용자가 호출할 때 에러 발생 확인
     *  - initializeSchedule, setVestingToken, backfillPurchaseAt, syncLimitDay 함수 테스트
     *  - OwnableUnauthorizedAccount 커스텀 에러와 함께 호출자 주소가 올바르게 전달되는지 검증
     * 
     * 테스트 시나리오:
     *  1. 일반 사용자가 베스팅 스케줄 초기화 시도 → 에러 발생
     *  2. 일반 사용자가 베스팅 토큰 주소 설정 시도 → 에러 발생
     *  3. 일반 사용자가 과거 구매 데이터 백필 시도 → 에러 발생
     *  4. 일반 사용자가 제한된 일수로 동기화 시도 → 에러 발생
     */
    it("onlyOwner 보호: backfill/initialize/setVestingToken/syncLimitDay", async () => {
        // === 테스트 환경 설정 ===
        const { vesting, stableCoin, buyer, start, DAY } = await deployFixture();

        // 테스트용 스케줄 파라미터 설정
        const ends2 = [
            start - 1n + DAY * 10n,  // 10일 후 종료
            start - 1n + DAY * 20n,  // 20일 후 종료
        ];
        const totals2 = [1n, 1n];  // 각 기간별 총량

        // === 1) initializeSchedule 테스트 ===
        // 일반 사용자가 베스팅 스케줄을 초기화하려고 시도할 때 에러 발생 확인
        // 이미 초기화됨, but 첫 번째 장벽은 onlyOwner
        await expect(
            vesting.connect(buyer).initializeSchedule(ends2, totals2, totals2)
        ).to.be.revertedWithCustomError(vesting, "OwnableUnauthorizedAccount")
         .withArgs(buyer.address);

        // === 2) setVestingToken 테스트 ===
        // 일반 사용자가 베스팅 토큰 주소를 설정하려고 시도할 때 에러 발생 확인
        await expect(
            vesting.connect(buyer).setVestingToken(await stableCoin.getAddress())
        ).to.be.revertedWithCustomError(vesting, "OwnableUnauthorizedAccount")
         .withArgs(buyer.address);

        // === 3) backfillPurchaseAt 테스트 ===
        // 일반 사용자가 과거 구매 데이터를 백필하려고 시도할 때 에러 발생 확인
        // referrer를 문자열 코드로 받는 새 시그니처 사용
        // 빈 문자열 "" = 레퍼럴 없음 (onlyOwner에서 먼저 revert됨)
        await expect(
            vesting.connect(buyer).backfillPurchaseAt(
                buyer.address,   // buyer: 구매자 주소
                "",              // refCodeStr: 레퍼럴 코드 (레퍼럴 없음)
                1n,              // boxCount: 박스 개수
                start,           // purchaseTs: 구매 타임스탬프
                0n,              // paidUnits: 지불한 USDT 단위 (6자리 소수점)
                false            // creditBuyback: 바이백 크레딧 사용 여부
            )
        ).to.be.revertedWithCustomError(vesting, "OwnableUnauthorizedAccount")
         .withArgs(buyer.address);

        // === 4) syncLimitDay 테스트 ===
        // 일반 사용자가 제한된 일수로 동기화를 시도할 때 에러 발생 확인
        await expect(
            vesting.connect(buyer).syncLimitDay(1)
        ).to.be.revertedWithCustomError(vesting, "OwnableUnauthorizedAccount")
         .withArgs(buyer.address);
    });
});
