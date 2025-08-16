// test/vesting.buyback.test.js
const { expect } = require("chai");
const { deployFixture } = require("./helpers/vestingFixture");

describe("vesting.buyback", function () {

  it("적립 후 claimBuyback 전송/이벤트/상태 초기화", async () => {
    const { vesting, stableCoin, buyer, referrer, start, ONE_USDT, DAY, seedReferralFor } = await deployFixture();

    // 레퍼럴 코드 세팅 (예: "SPLALABS")
    const refCode = await seedReferralFor(referrer);

    // d=1에 referrer가 얹힌 구매 백필 (바이백 적립)
    const paid = ONE_USDT * 123n;
    await vesting.backfillPurchaseAt(
      buyer.address,  // buyer
      refCode,        // refCodeStr (문자열 코드)
      1n,             // boxCount
      start + DAY,    // purchaseTs (d=1)
      paid,           // paidUnits
      true            // creditBuyback
    );
    const expected = (paid * 10n) / 100n;

    // 컨트랙트가 지급할 USDT 선입금
    await stableCoin.transfer(await vesting.getAddress(), expected);

    const before = await stableCoin.balanceOf(referrer.address);

    await expect(vesting.connect(referrer).claimBuyback())
      .to.emit(vesting, "BuybackClaimed")
      .withArgs(referrer.address, expected);

    const after = await stableCoin.balanceOf(referrer.address);
    expect(after - before).to.equal(expected);

    // 두 번째 호출 → nothing
    await expect(vesting.connect(referrer).claimBuyback())
      .to.be.revertedWith("nothing");
  });
});
