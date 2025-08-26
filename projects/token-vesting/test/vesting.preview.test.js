// test/vesting.preview.test.js
/**
 * @fileoverview TokenVesting 컨트랙트의 보상 미리보기(preview) 기능 테스트
 * @description
 * - 특정 시점에서의 클레임 가능한 보상 미리보기 기능 검증
 * - sync 전후 동일한 시점 기준 미리보기 값의 일치성 확인
 * - 구매자 풀과 추천인 풀의 미리보기 함수 정확성 검증
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");            // ★ 추가
const { deployFixture } = require("./helpers/vestingFixture");

function makePermit(value, deadline = 0n, v = 0, r = ethers.ZeroHash, s = ethers.ZeroHash) {
  return { value, deadline, v, r, s };
}

describe("vesting.preview", function () {

  /**
   * @test previewBuyer/Referrer: sync 후에도 같은 ts 기준 값이 일치
   * @description
   * - 특정 시점(ts)에서의 보상 미리보기 값을 sync 전후로 비교
   * - sync 전후 동일한 시점 기준으로 미리보기 값이 일치하는지 확인
   * - previewBuyerClaimableAt과 previewReferrerClaimableAt 함수의 정확성 검증
   */
  it("previewBuyer/Referrer: sync 후에도 같은 ts 기준 값이 일치", async () => {
    const {
      buyer, referrer, vesting, stableCoin,  // ★ stableCoin도 가져옴
      start, DAY, seedReferralFor, increaseTime
    } = await deployFixture();

    // 최초 sync 수행
    await increaseTime(DAY + 1n);
    await vesting.sync();

    // referrer 사용자에게 레퍼럴 코드 할당
    const refCode = await seedReferralFor(referrer);

    // (옵션) buyer가 미리 approve — 전송액 0이어도 안전하게 허용치 부여
    await stableCoin.connect(buyer).approve(await vesting.getAddress(), ethers.MaxUint256);

    // 박스 구매: 2개 박스를 referrer의 코드로 구매
    const boxCount = 2n;
    const estimated = await vesting.estimatedTotalAmount(boxCount, refCode); // ★ 견적 구해서
    expect(estimated).to.be.gt(0n); //   유효성 확인
    const pSkip = makePermit(estimated, 0n); // ★ p.value=estimated

    await expect(vesting.connect(buyer).buyBox(boxCount, refCode, pSkip))
      .to.emit(vesting, "BoxesPurchased");

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
