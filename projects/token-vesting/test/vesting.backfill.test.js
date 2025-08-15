// test/vesting.backfill.test.js
const { expect } = require("chai");
const { deployFixture } = require("./helpers/vestingFixture");

describe("vesting.backfill", function () {

  it("start 이전 ts → d=0 기록, 분모는 d=1부터 반영", async () => {
    const { vesting, buyer, start, ONE_USDT, DAY, increaseTime } = await deployFixture();

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

    // 아직 확정 전이므로 rewardPerBox[0]==0 예상 (sync 전이라 읽을 값은 0일 수 있음)
    await increaseTime(DAY * 2n + 1n);
    await vesting.sync();

    // d=0 확정: perBox[0]=0, cumBoxes[0]=5
    expect(await vesting.rewardPerBox(0n)).to.equal(0n);
    expect(await vesting.cumBoxes(0n)).to.equal(5n);
  });

  it("확정된 날짜에 백필 시도 → revert('day finalized')", async () => {
    const { vesting, buyer, start, ONE_USDT, DAY, increaseTime } = await deployFixture();

    // 하루 확정
    await increaseTime(DAY + 1n);
    await vesting.sync(); // lastSyncedDay=1 → d=0 확정됨

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
