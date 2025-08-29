// test/vesting.backfill.test.js
/**
 * @fileoverview 
 *  TokenVesting 컨트랙트의 과거 구매 데이터 백필 기능 테스트
 * @description 
 *  - 베스팅 시작일 이전 구매 데이터의 백필 처리 검증
 *  - 확정된 날짜에 대한 백필 시도 시 에러 처리 검증
 *  - 백필된 데이터의 on-chain 상태 변화 확인
 * 
 * 테스트 목적:
 *  - 과거 구매 데이터의 정확한 백필 처리 검증
 *  - 베스팅 시작일 기준 날짜 계산 로직 검증
 *  - 확정된 데이터의 무결성 보호 기능 테스트
 *  - 백필된 데이터의 보상 계산에 미치는 영향 검증
 * 
 * @author hlibbc
 */
const { expect } = require("chai");
const { deployFixture } = require("./helpers/vestingFixture");

// =============================================================================
// 과거 구매 데이터 백필 기능 테스트 스위트
// =============================================================================

/**
 * @describe 과거 구매 데이터 백필 기능 테스트
 * @description 
 *  1. 베스팅 시작일 이전 구매 데이터의 백필 처리 및 상태 변화 검증
 *  2. 이미 확정된 날짜에 대한 백필 시도 시 에러 발생 확인
 *  3. 백필된 데이터가 보상 계산에 미치는 영향 검증
 */
describe("vesting.backfill", function () {

    // =============================================================================
    // 베스팅 시작일 이전 구매 데이터 백필 테스트
    // =============================================================================

    /**
     * @test start 이전 ts → d=0 기록, 분모는 d=1부터 반영
     * @description 
     *  - 베스팅 시작일 이전의 구매 데이터를 백필할 때 d=0으로 기록되는지 확인
     *  - d=0일의 rewardPerBox는 0이 되고, cumBoxes는 백필된 박스 수로 설정되는지 검증
     *  - 분모(denominator)는 d=1부터 반영되어 보상 계산에 사용되는지 확인
     * 
     * 테스트 시나리오:
     *  1. 베스팅 시작일 10일 전의 구매 데이터 백필
     *  2. 2일 경과 후 sync 실행
     *  3. d=0일의 rewardPerBox와 cumBoxes 검증
     * 
     * 예상 결과:
     *  - d=0일은 백필된 박스 수(5개)로 cumBoxes 설정
     *  - rewardPerBox[0] > 0 (분모에 당일 누적 포함)
     */
    it("start 이전 ts → d=0 기록, 분모는 d=0부터 반영", async () => {
        // === 테스트 환경 설정 ===
        const { vesting, buyer, start, ONE_USDT, DAY, increaseTime } = await deployFixture();

        // === 베스팅 시작일 10일 전의 구매 데이터 백필 ===
        // 베스팅 시작일보다 이전의 구매 데이터는 d=0으로 기록됨
        const pastTs = start - DAY * 10n; // < start (베스팅 시작일보다 10일 전)
        await expect(
            vesting.backfillPurchaseAt(
                buyer.address,     // buyer: 구매자 주소
                "",                // refCodeStr: 레퍼럴 코드 (레퍼럴 없음)
                5n,                // boxCount: 박스 개수 (5개)
                pastTs,            // purchaseTs: 구매 타임스탬프 (과거)
                ONE_USDT * 5n,     // paidUnits: 지불한 USDT 단위 (5 USDT)
                true               // creditBuyback: 바이백 크레딧 사용 여부
            )
        ).to.not.be.reverted;

        // === 2일 경과 후 sync 실행 ===
        // 시간을 진행하여 베스팅 시스템이 다음 날로 넘어가도록 함
        await increaseTime(DAY * 2n + 1n);
        await vesting.sync();

        // === d=0 확정 상태 검증 ===
        // 분모에 당일 누적 포함 → rewardPerBox[0] > 0
        const day0PerBox = await vesting.rewardPerBox(0n);
        expect(day0PerBox).to.be.gt(0n);
        
        // cumBoxes[0]는 백필된 5개 박스로 설정됨
        expect(await vesting.cumBoxes(0n)).to.equal(5n);
    });

    // =============================================================================
    // 확정된 날짜 백필 시도 에러 처리 테스트
    // =============================================================================

    /**
     * @test 확정된 날짜에 백필 시도 → revert('day finalized')
     * @description 
     *  - 이미 sync()로 확정된 날짜에 백필을 시도할 때 에러 발생 확인
     *  - "day finalized" 에러 메시지 검증
     *  - 확정된 데이터의 무결성 보호 기능 테스트
     * 
     * 테스트 시나리오:
     *  1. 하루 경과 후 sync 실행하여 d=0일 확정
     *  2. 이미 확정된 d=0일에 백필 시도
     *  3. "day finalized" 에러 발생 확인
     * 
     * 보안 목적:
     *  - 확정된 데이터의 무결성 보호
     *  - 과거 데이터 조작 방지
     *  - 베스팅 시스템의 신뢰성 유지
     */
    it("확정된 날짜에 백필 시도 → revert('day finalized')", async () => {
        // === 테스트 환경 설정 ===
        const { vesting, buyer, start, ONE_USDT, DAY, increaseTime } = await deployFixture();

        // === 하루 확정: 시간을 진행하여 sync 가능하게 함 ===
        // 베스팅 시작일로부터 하루가 지나면 d=0일이 확정됨
        await increaseTime(DAY + 1n);
        await vesting.sync(); // lastSyncedDay=1 → d=0 확정됨

        // === 이미 확정된 d=0일에 백필 시도 ===
        // 확정된 날짜에는 더 이상 백필이 불가능해야 함
        const ts_d0 = start; // d=0 (베스팅 시작일)
        await expect(
            vesting.backfillPurchaseAt(
                buyer.address,   // buyer: 구매자 주소
                "",              // refCodeStr: 레퍼럴 코드 (레퍼럴 없음)
                1n,              // boxCount: 박스 개수 (1개)
                ts_d0,           // purchaseTs: 구매 타임스탬프 (d=0일)
                ONE_USDT,        // paidUnits: 지불한 USDT 단위 (1 USDT)
                true             // creditBuyback: 바이백 크레딧 사용 여부
            )
        ).to.be.revertedWith("day finalized");
    });
});
