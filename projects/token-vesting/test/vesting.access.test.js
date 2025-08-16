// test/vesting.access.test.js
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployFixture } = require("./helpers/vestingFixture");

describe("vesting.access", function () {

  it("onlyOwner 보호: backfill/initialize/setVestingToken/syncLimitDay", async () => {
    const { vesting, stableCoin, buyer, start, DAY } = await deployFixture();

    const ends2 = [
      start - 1n + DAY * 10n,
      start - 1n + DAY * 20n,
    ];
    const totals2 = [1n, 1n];

    // initializeSchedule (already inited, but first barrier is onlyOwner)
    await expect(
      vesting.connect(buyer).initializeSchedule(ends2, totals2, totals2)
    ).to.be.revertedWithCustomError(vesting, "OwnableUnauthorizedAccount")
     .withArgs(buyer.address);

    // setVestingToken
    await expect(
      vesting.connect(buyer).setVestingToken(await stableCoin.getAddress())
    ).to.be.revertedWithCustomError(vesting, "OwnableUnauthorizedAccount")
     .withArgs(buyer.address);

    // backfillPurchaseAt (referrer를 문자열 코드로 받는 새 시그니처)
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

    // syncLimitDay
    await expect(
      vesting.connect(buyer).syncLimitDay(1)
    ).to.be.revertedWithCustomError(vesting, "OwnableUnauthorizedAccount")
     .withArgs(buyer.address);
  });
});
