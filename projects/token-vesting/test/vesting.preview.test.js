// test/vesting.preview.test.js
/**
 * @fileoverview TokenVesting 컨트랙트의 보상 미리보기(preview) 기능 테스트
 * @description 
 * - 특정 시점에서의 클레임 가능한 보상 미리보기 기능 검증
 * - sync 전후 동일한 시점 기준 미리보기 값의 일치성 확인
 * - 구매자 풀과 추천인 풀의 미리보기 함수 정확성 검증
 */
const { expect } = require("chai");
const { deployFixture } = require("./helpers/vestingFixture");

/**
 * @describe 베스팅 보상 미리보기 기능 테스트
 * @description 
 * 1. 특정 시점에서의 보상 미리보기 값 계산
 * 2. sync 전후 동일한 시점 기준 미리보기 값의 일치성 검증
 * 3. 구매자 풀과 추천인 풀 각각의 미리보기 함수 정확성 확인
 */
describe("vesting.preview", function () {

  /**
   * @test previewBuyer/Referrer: sync 후에도 같은 ts 기준 값이 일치
   * @description 
   * - 특정 시점(ts)에서의 보상 미리보기 값을 sync 전후로 비교
   * - sync 전후 동일한 시점 기준으로 미리보기 값이 일치하는지 확인
   * - previewBuyerClaimableAt과 previewReferrerClaimableAt 함수의 정확성 검증
   */
  it("previewBuyer/Referrer: sync 후에도 같은 ts 기준 값이 일치", async () => {
    const { buyer, referrer, vesting, start, DAY, seedReferralFor, increaseTime } = await deployFixture();
    
    // referrer 사용자에게 레퍼럴 코드 할당
    const refCode = await seedReferralFor(referrer);

    // 박스 구매: 2개 박스를 referrer의 코드로 구매
    const pSkip = { value: 0n, deadline: 0n, v: 0, r: "0x" + "0".repeat(64), s: "0x" + "0".repeat(64) };
    await vesting.connect(buyer).buyBox(2n, await refCode, pSkip);

    // 2일 뒤 시점(ts)을 기준으로 미리보기
    // 베스팅 시작일로부터 2일 후의 시점에서 클레임 가능한 보상 미리보기
    const ts = start + DAY * 2n;
    const prevBuyer = await vesting.previewBuyerClaimableAt(buyer.address, ts);
    const prevRef   = await vesting.previewReferrerClaimableAt(referrer.address, ts);

    // 실제로 2일 경과 + sync
    // 현재 블록 타임스탬프를 기준으로 시간을 진행하여 실제 2일 경과 시뮬레이션
    const now = BigInt((await ethers.provider.getBlock("latest")).timestamp);
    const delta = ts - now + 1n; // +1s 여유 (정확한 시간 계산을 위한 여유 시간)
    await increaseTime(delta);
    await vesting.sync(); // 동기화를 통해 보상 확정

    // 같은 ts로 다시 미리보기 → 동일해야 함
    // sync 전후 동일한 시점(ts)에서의 미리보기 값이 일치하는지 확인
    const afterBuyer = await vesting.previewBuyerClaimableAt(buyer.address, ts);
    const afterRef   = await vesting.previewReferrerClaimableAt(referrer.address, ts);

    // 미리보기 값이 sync 전후로 동일해야 함
    expect(afterBuyer).to.equal(prevBuyer);
    expect(afterRef).to.equal(prevRef);
  });
});
