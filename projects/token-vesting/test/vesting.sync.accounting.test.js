// test/vesting.sync.accounting.test.js
/**
 * @fileoverview TokenVesting 컨트랙트의 동기화(sync) 회계 로직 테스트
 * @description
 * - 베스팅 시작일(d=0)과 그 이후 날짜들의 보상 계산 로직 검증
 * - 분모(denominator) 반영 시점과 보상 계산 정확성 확인
 * - 일별 보상 단가(rewardPerBox)와 누적 박스 수(cumBoxes)의 변화 추적
 */
const { expect } = require("chai");
const { ethers } = require("hardhat"); // ★ 추가
const { deployFixture } = require("./helpers/vestingFixture");

/**
 * @describe 베스팅 동기화 회계 로직 테스트
 * @description
 * 1. 베스팅 시작일(d=0)에서의 보상 계산 로직 검증
 * 2. d=1부터 분모가 cumBoxes[0]로 설정되는 로직 확인
 * 3. 일별 보상 단가와 누적 데이터의 정확성 검증
 */
describe("vesting.sync.accounting", function () {

  /**
   * @test effDay/분모 반영: d=0 보상>0(정책 변경), d=1부터 분모=cumBoxes[0]
   * @description
   * - (정책 변경 반영) d=0 판매는 d=0부터 바로 보상에 반영됨
   * - d=0의 분모는 (이전 누적 + d=0 당일 추가분) → 당일 판매가 있으면 perBox[0] > 0
   * - d=1부터는 분모가 cumBoxes[0]로 고정되어 다음 날 보상 계산 진행
   */
  it("effDay/분모 반영: d=0 보상>0, d=1부터 분모=cumBoxes[0]", async () => {
    const { buyer, referrer, vesting, DAY, seedReferralFor, increaseTime } = await deployFixture();

    // referrer 코드 세팅
    const refCode = await seedReferralFor(referrer);

    // d=0에서 구매: 3개 박스
    const boxCount = 3n;
    const estimated = await vesting.estimatedTotalAmount(boxCount, refCode);
    expect(estimated).to.be.gt(0n);

    const pSkip = { value: estimated, deadline: 0n, v: 0, r: ethers.ZeroHash, s: ethers.ZeroHash };
    await expect(vesting.connect(buyer).buyBox(boxCount, refCode, pSkip))
      .to.emit(vesting, "BoxesPurchased");

    // 1일 경과 → d=0 확정
    await increaseTime(DAY + 1n);
    await vesting.sync();

    // (정책 변경 반영)
    // d=0: 분모 = (전일 누적 0) + (당일 추가분 boxesAddedPerDay[0]=3) → perBox[0] > 0
    const per0 = await vesting.rewardPerBox(0n);
    expect(per0 > 0n).to.equal(true);

    // 누적 박스는 d=0 당일 판매 누적치와 동일
    expect(await vesting.cumBoxes(0n)).to.equal(3n);

    // 추가로 1일 더 경과 → d=1 확정
    await increaseTime(DAY + 1n);
    await vesting.sync();

    // d=1: 분모=cumBoxes[0]=3 → perBox[1] > 0
    const per1 = await vesting.rewardPerBox(1n);
    expect(per1 > 0n).to.equal(true);
  });
});
