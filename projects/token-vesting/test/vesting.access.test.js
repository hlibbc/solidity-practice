// test/vesting.access.test.js
/**
 * @fileoverview TokenVesting 컨트랙트의 접근 제어(onlyOwner) 기능 테스트
 * @description 
 * - 관리자 전용 함수들의 onlyOwner 보호 기능 검증
 * - 일반 사용자가 관리자 함수 호출 시도 시 에러 발생 확인
 * - OwnableUnauthorizedAccount 커스텀 에러 메시지 검증
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployFixture } = require("./helpers/vestingFixture");

/**
 * @describe 베스팅 컨트랙트의 접근 제어 기능 테스트
 * @description 
 * - onlyOwner로 보호된 관리자 전용 함수들의 접근 제어 검증
 * - 일반 사용자(buyer)가 관리자 함수를 호출할 때 적절한 에러 발생 확인
 */
describe("vesting.access", function () {

  /**
   * @test onlyOwner 보호: backfill/initialize/setVestingToken/syncLimitDay
   * @description 
   * - 관리자 전용 함수들을 일반 사용자가 호출할 때 에러 발생 확인
   * - initializeSchedule, setVestingToken, backfillPurchaseAt, syncLimitDay 함수 테스트
   * - OwnableUnauthorizedAccount 커스텀 에러와 함께 호출자 주소가 올바르게 전달되는지 검증
   */
  it("onlyOwner 보호: backfill/initialize/setVestingToken/syncLimitDay", async () => {
    const { vesting, stableCoin, buyer, start, DAY } = await deployFixture();

    // 테스트용 스케줄 파라미터 설정
    const ends2 = [
      start - 1n + DAY * 10n,  // 10일 후 종료
      start - 1n + DAY * 20n,  // 20일 후 종료
    ];
    const totals2 = [1n, 1n];  // 각 기간별 총량

    // 1) initializeSchedule 테스트 (이미 초기화됨, but 첫 번째 장벽은 onlyOwner)
    // 일반 사용자가 베스팅 스케줄을 초기화하려고 시도할 때 에러 발생 확인
    await expect(
      vesting.connect(buyer).initializeSchedule(ends2, totals2, totals2)
    ).to.be.revertedWithCustomError(vesting, "OwnableUnauthorizedAccount")
     .withArgs(buyer.address);

    // 2) setVestingToken 테스트
    // 일반 사용자가 베스팅 토큰 주소를 설정하려고 시도할 때 에러 발생 확인
    await expect(
      vesting.connect(buyer).setVestingToken(await stableCoin.getAddress())
    ).to.be.revertedWithCustomError(vesting, "OwnableUnauthorizedAccount")
     .withArgs(buyer.address);

    // 3) backfillPurchaseAt 테스트 (referrer를 문자열 코드로 받는 새 시그니처)
    // 일반 사용자가 과거 구매 데이터를 백필하려고 시도할 때 에러 발생 확인
    // 빈 문자열 "" = 레퍼럴 없음 (onlyOwner에서 먼저 revert됨)
    await expect(
      vesting.connect(buyer).backfillPurchaseAt(
        buyer.address,   // buyer
        "",              // refCodeStr (no referrer)
        1n,              // boxCount
        start,           // purchaseTs
        0n,              // paidUnits
        false            // creditBuyback
      )
    ).to.be.revertedWithCustomError(vesting, "OwnableUnauthorizedAccount")
     .withArgs(buyer.address);

    // 4) syncLimitDay 테스트
    // 일반 사용자가 제한된 일수로 동기화를 시도할 때 에러 발생 확인
    await expect(
      vesting.connect(buyer).syncLimitDay(1)
    ).to.be.revertedWithCustomError(vesting, "OwnableUnauthorizedAccount")
     .withArgs(buyer.address);
  });
});
