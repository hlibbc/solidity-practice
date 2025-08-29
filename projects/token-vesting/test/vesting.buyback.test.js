// test/vesting.buyback.test.js
/**
 * @fileoverview 
 *  TokenVesting 컨트랙트의 추천인 바이백(수수료 환급) 기능 테스트
 * @description 
 *  - 레퍼럴을 통한 구매 시 추천인에게 10% 바이백 적립 기능 검증
 *  - claimBuyback 함수를 통한 바이백 청구 및 전송 검증
 *  - 바이백 청구 후 상태 초기화 및 중복 청구 방지 기능 테스트
 * 
 * 테스트 목적:
 *  - 레퍼럴 시스템의 바이백 적립 메커니즘 검증
 *  - 바이백 청구 및 전송 프로세스의 정확성 확인
 *  - 바이백 시스템의 상태 관리 및 보안 기능 테스트
 *  - 중복 청구 방지를 통한 시스템 무결성 보장
 * 
 * 바이백 시스템 개요:
 *  - 레퍼럴을 통한 구매 시 추천인에게 결제액의 10% 바이백 적립
 *  - 적립된 바이백은 claimBuyback 함수로 청구 가능
 *  - 청구 후 바이백 잔액은 0으로 초기화되어 중복 청구 방지
 * 
 * @author hlibbc
 */
const { expect } = require("chai");
const { deployFixture } = require("./helpers/vestingFixture");

// =============================================================================
// 추천인 바이백 기능 테스트 스위트
// =============================================================================

/**
 * @describe 추천인 바이백 기능 테스트
 * @description 
 *  1. 레퍼럴을 통한 구매 시 바이백 적립 기능 검증
 *  2. claimBuyback 함수를 통한 바이백 청구 및 전송 검증
 *  3. 바이백 청구 후 상태 초기화 및 중복 청구 방지 기능 테스트
 * 
 * 테스트 시나리오:
 *  - 레퍼럴 코드를 통한 구매 데이터 백필
 *  - 바이백 적립 및 예상 금액 계산
 *  - 바이백 청구 및 이벤트 발생 확인
 *  - 상태 초기화 및 중복 청구 방지 검증
 */
describe("vesting.buyback", function () {
    // =============================================================================
    // 바이백 적립 및 청구 통합 테스트
    // =============================================================================

    /**
     * @test 적립 후 claimBuyback 전송/이벤트/상태 초기화
     * @description 
     *  - 레퍼럴을 통한 구매 시 추천인에게 10% 바이백 적립
     *  - claimBuyback 함수 호출 시 BuybackClaimed 이벤트 발생 및 USDT 전송
     *  - 바이백 청구 후 잔액 0으로 초기화 및 중복 청구 시 "nothing" 에러 발생
     * 
     * 테스트 단계:
     *  1. 레퍼럴 코드 설정 및 구매 데이터 백필
     *  2. 바이백 적립 및 예상 금액 계산
     *  3. 컨트랙트에 USDT 선입금
     *  4. 바이백 청구 및 이벤트 발생 확인
     *  5. USDT 전송 및 잔액 변화 검증
     *  6. 중복 청구 시 에러 발생 확인
     * 
     * 예상 결과:
     *  - 바이백이 정확히 적립됨 (결제액의 10%)
     *  - BuybackClaimed 이벤트가 발생함
     *  - USDT가 정확히 전송됨
     *  - 바이백 잔액이 0으로 초기화됨
     *  - 중복 청구 시 "nothing" 에러 발생
     */
    it("적립 후 claimBuyback 전송/이벤트/상태 초기화", async () => {
        // === 테스트 환경 설정 ===
        const { vesting, stableCoin, buyer, referrer, start, ONE_USDT, DAY, seedReferralFor } = await deployFixture();

        // === 레퍼럴 코드 세팅 ===
        // referrer 사용자에게 고유한 레퍼럴 코드 할당 (예: "SPLALABS")
        const refCode = await seedReferralFor(referrer);

        // === d=1에 referrer가 얹힌 구매 백필 (바이백 적립) ===
        // buyer가 referrer의 코드를 사용하여 구매하고, creditBuyback=true로 설정
        // creditBuyback=true는 10% 바이백 적립을 의미
        const paid = ONE_USDT * 123n; // 123 USDT 결제 (123,000,000 최소 단위)
        await vesting.backfillPurchaseAt(
            buyer.address,  // buyer: 구매자 주소
            refCode,        // refCodeStr: 레퍼럴 코드 (문자열 코드)
            1n,             // boxCount: 박스 개수 (1개)
            start + DAY,    // purchaseTs: 구매 타임스탬프 (d=1일)
            paid,           // paidUnits: 지불한 USDT 단위 (6자리 소수점)
            true            // creditBuyback: 10% 바이백 적립 활성화
        );
        
        // === 예상 바이백 금액 계산 ===
        // 결제액의 10%를 바이백으로 적립
        const expected = (paid * 10n) / 100n; // 12.3 USDT (12,300,000 최소 단위)

        // === 컨트랙트가 지급할 USDT 선입금 ===
        // 바이백 청구 시 전송할 USDT를 컨트랙트에 미리 입금
        // 실제 운영에서는 컨트랙트가 충분한 USDT를 보유해야 함
        await stableCoin.transfer(await vesting.getAddress(), expected);

        // === 바이백 청구 전 referrer의 USDT 잔액 기록 ===
        // 바이백 청구 전후 잔액 변화를 비교하기 위해 사전 기록
        const before = await stableCoin.balanceOf(referrer.address);

        // === claimBuyback 함수 호출 및 이벤트 발생 확인 ===
        // referrer가 바이백을 청구하고 BuybackClaimed 이벤트 발생 확인
        await expect(vesting.connect(referrer).claimBuyback())
            .to.emit(vesting, "BuybackClaimed")
            .withArgs(referrer.address, expected);

        // === 바이백 청구 후 referrer의 USDT 잔액 증가 확인 ===
        // 바이백 청구 후 referrer의 USDT 잔액이 정확히 증가했는지 검증
        const after = await stableCoin.balanceOf(referrer.address);
        expect(after - before).to.equal(expected);

        // === 두 번째 호출 → nothing 에러 발생 확인 ===
        // 바이백은 이미 청구되어 잔액이 0으로 초기화되었으므로 "nothing" 에러 발생
        // 이는 중복 청구를 방지하는 보안 기능
        await expect(vesting.connect(referrer).claimBuyback())
            .to.be.revertedWith("nothing");
    });
});
