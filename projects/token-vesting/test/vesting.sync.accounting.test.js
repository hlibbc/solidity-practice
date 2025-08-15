// test/vesting.sync.accounting.test.js
const { expect } = require("chai");
const { deployFixture } = require("./helpers/vestingFixture");

describe("vesting.sync.accounting", function () {

  it("effDay/분모 반영: d=0 보상=0, d=1부터 분모=cumBoxes[0]", async () => {
    const { buyer, referrer, vesting, start, DAY, seedReferralFor, increaseTime } = await deployFixture();
    const refCode = await seedReferralFor(referrer);

    // d=0에서 구매
    const pSkip = { value: 0n, deadline: 0n, v: 0, r: "0x" + "0".repeat(64), s: "0x" + "0".repeat(64) };
    await vesting.connect(buyer).buyBox(3n, await refCode, pSkip);

    // 1일 경과 → d=0 확정
    await increaseTime(DAY + 1n);
    await vesting.sync();

    // d=0: 분모=0 → perBox=0, cumBoxes[0]=3
    expect(await vesting.rewardPerBox(0n)).to.equal(0n);
    expect(await vesting.cumBoxes(0n)).to.equal(3n);

    // 추가로 1일 더 경과 → d=1 확정
    await increaseTime(DAY + 1n);
    await vesting.sync();

    // d=1: 분모=cumBoxes[0]=3 → perBox > 0 (연차 total/termDays / 3)
    const per1 = await vesting.rewardPerBox(1n);
    expect(per1 > 0n).to.equal(true);
  });
});
