// test/vesting.claim.test.js
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployFixture } = require("./helpers/vestingFixture");

describe("vesting.claim", function () {

  it("claimPurchase/Referral: nothing to claim (lastSyncedDay==0) → revert", async () => {
    const { vesting, stableCoin, buyer, referrer } = await deployFixture();

    // vestingToken 설정만 해두면 됨(전송 전에 'nothing to claim'에서 멈춘다)
    await vesting.setVestingToken(await stableCoin.getAddress());

    await expect(vesting.connect(buyer).claimPurchaseReward())
      .to.be.revertedWith("nothing to claim");

    await expect(vesting.connect(referrer).claimReferralReward())
      .to.be.revertedWith("nothing to claim");
  });

  // (참고) 실제 성공 클레임 테스트는 vestingToken(18dec) 모의토큰을 배포/충전해서 진행 필요.
  // 금액이 매우 크므로 별도 Mock(18dec mint) 추가 시 작성 권장.
});
