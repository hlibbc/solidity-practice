// test/vesting.backfill.test.js
/**
 * @fileoverview TokenVesting 컨트랙트의 과거 구매 데이터 백필 기능 테스트
 * @description 
 * - 베스팅 시작일 이전 구매 데이터의 백필 처리 검증
 * - 확정된 날짜에 대한 백필 시도 시 에러 처리 검증
 * - 백필된 데이터의 on-chain 상태 변화 확인
 */
const { expect } = require("chai");
const { deployFixture } = require("./helpers/vestingFixture");

/**
 * @describe 과거 구매 데이터 백필 기능 테스트
 * @description 
 * 1. 베스팅 시작일 이전 구매 데이터의 백필 처리 및 상태 변화 검증
 * 2. 이미 확정된 날짜에 대한 백필 시도 시 에러 발생 확인
 */
describe("vesting.backfill", function () {

  /**
   * @test start 이전 ts → d=0 기록, 분모는 d=1부터 반영
   * @description 
   * - 베스팅 시작일 이전의 구매 데이터를 백필할 때 d=0으로 기록되는지 확인
   * - d=0일의 rewardPerBox는 0이 되고, cumBoxes는 백필된 박스 수로 설정되는지 검증
   * - 분모(denominator)는 d=1부터 반영되어 보상 계산에 사용되는지 확인
   */
  it("start 이전 ts → d=0 기록, 분모는 d=0부터 반영", async () => {
    const { vesting, buyer, start, ONE_USDT, DAY, increaseTime } = await deployFixture();

    // 베스팅 시작일 10일 전의 구매 데이터 백필
    const pastTs = start - DAY * 10n; // < start
    await expect(
      vesting.backfillPurchaseAt(
        buyer.address,     // buyer
        "",                // refCodeStr (레퍼럴 없음)
        5n,                // boxCount
        pastTs,            // purchaseTs
        ONE_USDT * 5n,     // paidUnits
        true               // creditBuyback
      )
    ).to.not.be.reverted;

    // 2일 경과 후 sync
    await increaseTime(DAY * 2n + 1n);
    await vesting.sync();

    // d=0 확정: 분모에 당일 누적 포함 → rewardPerBox[0] > 0
    const day0PerBox = await vesting.rewardPerBox(0n);
    expect(day0PerBox).to.be.gt(0n);
    // cumBoxes[0]는 백필된 5개 박스로 설정됨
    expect(await vesting.cumBoxes(0n)).to.equal(5n);
  });

  /**
   * @test 확정된 날짜에 백필 시도 → revert('day finalized')
   * @description 
   * - 이미 sync()로 확정된 날짜에 백필을 시도할 때 에러 발생 확인
   * - "day finalized" 에러 메시지 검증
   * - 확정된 데이터의 무결성 보호 기능 테스트
   */
  it("확정된 날짜에 백필 시도 → revert('day finalized')", async () => {
    const { vesting, buyer, start, ONE_USDT, DAY, increaseTime } = await deployFixture();

    // 하루 확정: 시간을 진행하여 sync 가능하게 함
    await increaseTime(DAY + 1n);
    await vesting.sync(); // lastSyncedDay=1 → d=0 확정됨

    // 이미 확정된 d=0일에 백필 시도
    const ts_d0 = start; // d=0
    await expect(
      vesting.backfillPurchaseAt(
        buyer.address,   // buyer
        "",              // refCodeStr (레퍼럴 없음)
        1n,              // boxCount
        ts_d0,           // purchaseTs
        ONE_USDT,        // paidUnits
        true             // creditBuyback
      )
    ).to.be.revertedWith("day finalized");
  });
});
