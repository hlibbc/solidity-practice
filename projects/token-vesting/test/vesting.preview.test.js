// test/vesting.preview.test.js
const { expect } = require("chai");
const { deployFixture } = require("./helpers/vestingFixture");

describe("vesting.preview", function () {

  it("previewBuyer/Referrer: sync 후에도 같은 ts 기준 값이 일치", async () => {
    const { buyer, referrer, vesting, start, DAY, seedReferralFor, increaseTime } = await deployFixture();
    const refCode = await seedReferralFor(referrer);

    const pSkip = { value: 0n, deadline: 0n, v: 0, r: "0x" + "0".repeat(64), s: "0x" + "0".repeat(64) };
    await vesting.connect(buyer).buyBox(2n, await refCode, pSkip);

    // 2일 뒤 시점(ts)을 기준으로 미리보기
    const ts = start + DAY * 2n;
    const prevBuyer = await vesting.previewBuyerClaimableAt(buyer.address, ts);
    const prevRef   = await vesting.previewReferrerClaimableAt(referrer.address, ts);

    // 실제로 2일 경과 + sync
    const now = BigInt((await ethers.provider.getBlock("latest")).timestamp);
    const delta = ts - now + 1n; // +1s 여유
    await increaseTime(delta);
    await vesting.sync();

    // 같은 ts로 다시 미리보기 → 동일해야 함
    const afterBuyer = await vesting.previewBuyerClaimableAt(buyer.address, ts);
    const afterRef   = await vesting.previewReferrerClaimableAt(referrer.address, ts);

    expect(afterBuyer).to.equal(prevBuyer);
    expect(afterRef).to.equal(prevRef);
  });
});
