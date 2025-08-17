// test/vesting.sync.accounting.test.js
/**
 * @fileoverview TokenVesting 컨트랙트의 동기화(sync) 회계 로직 테스트
 * @description 
 * - 베스팅 시작일(d=0)과 그 이후 날짜들의 보상 계산 로직 검증
 * - 분모(denominator) 반영 시점과 보상 계산 정확성 확인
 * - 일별 보상 단가(rewardPerBox)와 누적 박스 수(cumBoxes)의 변화 추적
 */
const { expect } = require("chai");
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
   * @test effDay/분모 반영: d=0 보상=0, d=1부터 분모=cumBoxes[0]
   * @description 
   * - 베스팅 시작일(d=0)에서 구매한 박스는 d=1부터 보상에 반영되는 로직 검증
   * - d=0일의 보상은 분모가 0이므로 rewardPerBox[0] = 0
   * - d=1일부터는 분모가 cumBoxes[0]로 설정되어 실제 보상 계산 시작
   */
  it("effDay/분모 반영: d=0 보상=0, d=1부터 분모=cumBoxes[0]", async () => {
    const { buyer, referrer, vesting, start, DAY, seedReferralFor, increaseTime } = await deployFixture();
    
    // referrer 사용자에게 레퍼럴 코드 할당
    const refCode = await seedReferralFor(referrer);

    // d=0에서 구매: 베스팅 시작일에 3개 박스 구매
    // 구매한 박스는 다음 날(d=1)부터 보상에 반영됨 (effDay = 구매일 + 1)
    const pSkip = { value: 0n, deadline: 0n, v: 0, r: "0x" + "0".repeat(64), s: "0x" + "0".repeat(64) };
    await vesting.connect(buyer).buyBox(3n, await refCode, pSkip);

    // 1일 경과 → d=0 확정
    // 베스팅 시작일로부터 1일이 경과하여 d=0일의 보상 확정
    await increaseTime(DAY + 1n);
    await vesting.sync();

    // d=0: 분모=0 → perBox=0, cumBoxes[0]=3
    // d=0일에는 아직 분모(누적 박스 수)가 0이므로 보상 단가도 0
    expect(await vesting.rewardPerBox(0n)).to.equal(0n);
    // cumBoxes[0]는 d=0일에 구매된 3개 박스로 설정됨
    expect(await vesting.cumBoxes(0n)).to.equal(3n);

    // 추가로 1일 더 경과 → d=1 확정
    // 베스팅 시작일로부터 2일이 경과하여 d=1일의 보상 확정
    await increaseTime(DAY + 1n);
    await vesting.sync();

    // d=1: 분모=cumBoxes[0]=3 → perBox > 0 (연차 total/termDays / 3)
    // d=1일부터는 분모가 cumBoxes[0]=3으로 설정되어 실제 보상 계산 시작
    // 보상 단가는 (연차 총량 / 연차 일수) / 분모로 계산됨
    const per1 = await vesting.rewardPerBox(1n);
    expect(per1 > 0n).to.equal(true);
  });
});
