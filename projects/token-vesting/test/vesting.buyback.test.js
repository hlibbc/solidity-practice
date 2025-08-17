// test/vesting.buyback.test.js
/**
 * @fileoverview TokenVesting 컨트랙트의 추천인 바이백(수수료 환급) 기능 테스트
 * @description 
 * - 레퍼럴을 통한 구매 시 추천인에게 10% 바이백 적립 기능 검증
 * - claimBuyback 함수를 통한 바이백 청구 및 전송 검증
 * - 바이백 청구 후 상태 초기화 및 중복 청구 방지 기능 테스트
 */
const { expect } = require("chai");
const { deployFixture } = require("./helpers/vestingFixture");

/**
 * @describe 추천인 바이백 기능 테스트
 * @description 
 * 1. 레퍼럴을 통한 구매 시 바이백 적립 기능 검증
 * 2. claimBuyback 함수를 통한 바이백 청구 및 전송 검증
 * 3. 바이백 청구 후 상태 초기화 및 중복 청구 방지 기능 테스트
 */
describe("vesting.buyback", function () {

  /**
   * @test 적립 후 claimBuyback 전송/이벤트/상태 초기화
   * @description 
   * - 레퍼럴을 통한 구매 시 추천인에게 10% 바이백 적립
   * - claimBuyback 함수 호출 시 BuybackClaimed 이벤트 발생 및 USDT 전송
   * - 바이백 청구 후 잔액 0으로 초기화 및 중복 청구 시 "nothing" 에러 발생
   */
  it("적립 후 claimBuyback 전송/이벤트/상태 초기화", async () => {
    const { vesting, stableCoin, buyer, referrer, start, ONE_USDT, DAY, seedReferralFor } = await deployFixture();

    // 레퍼럴 코드 세팅 (예: "SPLALABS")
    // referrer 사용자에게 고유한 레퍼럴 코드 할당
    const refCode = await seedReferralFor(referrer);

    // d=1에 referrer가 얹힌 구매 백필 (바이백 적립)
    // buyer가 referrer의 코드를 사용하여 구매하고, creditBuyback=true로 설정
    const paid = ONE_USDT * 123n; // 123 USDT 결제
    await vesting.backfillPurchaseAt(
      buyer.address,  // buyer
      refCode,        // refCodeStr (문자열 코드)
      1n,             // boxCount
      start + DAY,    // purchaseTs (d=1)
      paid,           // paidUnits
      true            // creditBuyback (10% 바이백 적립)
    );
    
    // 예상 바이백 금액 계산: 결제액의 10%
    const expected = (paid * 10n) / 100n;

    // 컨트랙트가 지급할 USDT 선입금
    // 바이백 청구 시 전송할 USDT를 컨트랙트에 미리 입금
    await stableCoin.transfer(await vesting.getAddress(), expected);

    // 바이백 청구 전 referrer의 USDT 잔액 기록
    const before = await stableCoin.balanceOf(referrer.address);

    // claimBuyback 함수 호출 및 이벤트 발생 확인
    await expect(vesting.connect(referrer).claimBuyback())
      .to.emit(vesting, "BuybackClaimed")
      .withArgs(referrer.address, expected);

    // 바이백 청구 후 referrer의 USDT 잔액 증가 확인
    const after = await stableCoin.balanceOf(referrer.address);
    expect(after - before).to.equal(expected);

    // 두 번째 호출 → nothing 에러 발생
    // 바이백은 이미 청구되어 잔액이 0으로 초기화되었으므로 "nothing" 에러
    await expect(vesting.connect(referrer).claimBuyback())
      .to.be.revertedWith("nothing");
  });
});
