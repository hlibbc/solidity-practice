// test/vesting.claim.test.js
/**
 * @fileoverview TokenVesting 컨트랙트의 보상 클레임 기능 테스트
 * @description 
 * - 구매자 풀과 추천인 풀의 보상 클레임 기능 검증
 * - 클레임 가능한 보상이 없을 때의 에러 처리 검증
 * - 베스팅 토큰이 설정되지 않은 상태에서의 클레임 시도 처리
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployFixture } = require("./helpers/vestingFixture");

/**
 * @describe 베스팅 보상 클레임 기능 테스트
 * @description 
 * 1. 클레임 가능한 보상이 없을 때의 에러 처리 검증
 * 2. 구매자 풀과 추천인 풀 각각의 클레임 기능 테스트
 * 3. 베스팅 토큰 설정 후 클레임 시도 시 적절한 에러 발생 확인
 */
describe("vesting.claim", function () {

  /**
   * @test claimPurchase/Referral: nothing to claim (lastSyncedDay==0) → revert
   * @description 
   * - 아직 베스팅이 시작되지 않았거나 동기화가 완료되지 않은 상태에서 클레임 시도 시 에러 발생 확인
   * - 구매자 풀과 추천인 풀 모두 "nothing to claim" 에러 발생 검증
   * - 베스팅 토큰이 설정되어 있어도 클레임 가능한 보상이 없으면 에러 발생
   */
  it("claimPurchase/Referral: nothing to claim (lastSyncedDay==0) → revert", async () => {
    const { vesting, stableCoin, buyer, referrer } = await deployFixture();

    // vestingToken 설정만 해두면 됨(전송 전에 'nothing to claim'에서 멈춘다)
    // 베스팅 토큰 주소를 설정하여 전송 준비 완료
    await vesting.setVestingToken(await stableCoin.getAddress());

    // 1) 구매자 풀 보상 클레임 시도 → "nothing to claim" 에러 발생
    // 아직 베스팅이 시작되지 않았거나 동기화가 완료되지 않은 상태
    await expect(vesting.connect(buyer).claimPurchaseReward())
      .to.be.revertedWith("nothing to claim");

    // 2) 추천인 풀 보상 클레임 시도 → "nothing to claim" 에러 발생
    // 레퍼럴 보상도 아직 확정되지 않은 상태
    await expect(vesting.connect(referrer).claimReferralReward())
      .to.be.revertedWith("nothing to claim");
  });

  // (참고) 실제 성공 클레임 테스트는 vestingToken(18dec) 모의토큰을 배포/충전해서 진행 필요.
  // 금액이 매우 크므로 별도 Mock(18dec mint) 추가 시 작성 권장.
  // 
  // 실제 클레임 성공 테스트를 위해서는:
  // 1. 18 decimals를 가진 Mock 베스팅 토큰 배포
  // 2. 컨트랙트에 충분한 토큰 충전
  // 3. 구매 데이터 백필 및 동기화 완료
  // 4. 클레임 가능한 보상이 있는 상태에서 클레임 실행
  // 5. 토큰 전송 성공 및 이벤트 발생 확인
});
