// test/vesting.pricing.test.js
/**
 * @fileoverview 
 *  TokenVesting 컨트랙트의 가격 정책 및 buyBox 금액 검증 테스트
 * @description
 *  - 다양한 구매 수량에 따른 가격 계산 정확성 검증
 *  - 티어 경계에서의 가격 전환 로직 검증
 *  - buyBox 함수의 금액 검증 및 에러 처리 검증
 *  - 레퍼럴 코드 유효성 검증
 * 
 * 테스트 목적:
 *  - 가격 정책의 정확성과 일관성 검증
 *  - 티어 시스템의 정상 동작 확인
 *  - buyBox 함수의 보안 기능 검증
 *  - 레퍼럴 시스템과 가격 계산의 연동 검증
 * 
 * 가격 정책 개요:
 *  - 초기 티어: 1-3199개 구매 시 350 USDT/박스
 *  - 중간 티어: 3200-9999개 구매 시 375 USDT/박스
 *  - 상한 티어: 10000개 이상 구매 시 1300 USDT/박스
 *  - 티어 경계에서의 혼합 가격 계산 지원
 * 
 * @author hlibbc
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployFixture } = require("./helpers/vestingFixture");

// =============================================================================
// 상수 및 유틸리티 함수들
// =============================================================================

/**
 * @notice USDT의 최소 단위 (6자리 소수점)
 * 1 USDT = 1,000,000 (10^6)
 */
const ONE_USDT = 10n ** 6n;

/**
 * @notice 하루를 초 단위로 표현 (24시간 * 60분 * 60초)
 * 베스팅 시스템에서 날짜 계산에 사용
 */
const DAY = 86400n;

/**
 * @notice permit 데이터를 생성하는 헬퍼 함수
 * @param {bigint} value - 허용할 토큰 수량
 * @returns {Object} permit 데이터 객체
 * 
 * 용도: permit 미사용으로 deadline=0 설정
 *       buyBox 내부에서 permit 경로를 스킵하고 approve 기반으로 처리
 */
function makePermit(value) {
    // permit 미사용: deadline=0 → buyBox 내부에서 permit 경로 스킵
    return {
        value,
        deadline: 0,
        v: 0,
        r: ethers.ZeroHash,
        s: ethers.ZeroHash,
    };
}

// =============================================================================
// 가격 정책 및 buyBox 금액 검증 테스트 스위트
// =============================================================================

/**
 * @describe TokenVesting - 가격 정책 및 buyBox 금액 검증 테스트
 * @description 
 *  - 다양한 구매 수량에 따른 가격 계산 정확성 검증
 *  - 티어 경계에서의 가격 전환 로직 검증
 *  - buyBox 함수의 금액 검증 및 에러 처리 검증
 *  - 레퍼럴 코드 유효성 검증
 * 
 * 테스트 시나리오:
 *  - 기본 가격 정책 검증 (초기 티어, 대량 구매)
 *  - 티어 경계에서의 가격 전환 검증
 *  - 상한 티어에서의 가격 고정 검증
 *  - buyBox 금액 불일치 시 에러 처리 검증
 *  - 연속 구매 시 가격 계산 정확성 검증
 *  - 유효하지 않은 레퍼럴 코드 처리 검증
 */
describe("TokenVesting - pricing & buyBox amount check (using vestingFixture)", function () {
    // =============================================================================
    // 테스트 변수 선언
    // =============================================================================

    let owner, buyer, referrer, other;
    let stableCoin, vesting, start, increaseTime, seedReferralFor;
    let refCode;

    // =============================================================================
    // 테스트 환경 설정 (각 테스트 전 실행)
    // =============================================================================

    /**
     * @notice 각 테스트 전에 실행되는 환경 설정 함수
     * @description 
     *  - deployFixture를 통한 테스트 환경 구성
     *  - 레퍼럴 코드 설정 및 buyer 토큰 준비
     *  - approve 설정으로 구매 준비 완료
     */
    beforeEach(async () => {
        // === 테스트 환경 구성 ===
        ({
            owner, buyer, referrer, other,
            stableCoin, vesting, start,
            increaseTime, seedReferralFor
        } = await deployFixture());

        // === 레퍼럴 코드 준비 ===
        // fixture가 SPLALABS로 세팅해줌
        refCode = await seedReferralFor(referrer);

        // === buyer에게 토큰 전송 및 approve 설정 ===
        // StableCoin 구현에 따라 필요 없을 수 있으나, 안전하게 승인 걸어둡니다.
        // 1,000 USDT를 buyer에게 전송
        await stableCoin.connect(owner).transfer(buyer.address, 1_000_000n * ONE_USDT);
        // buyer가 vesting 컨트랙트에 대한 approve 설정
        await stableCoin.connect(buyer).approve(await vesting.getAddress(), ethers.MaxUint256);
    });

    // =============================================================================
    // 헬퍼 함수들
    // =============================================================================

    /**
     * @notice 특정 수량과 레퍼럴 코드에 대한 총 가격 견적 조회
     * @param {bigint} qty - 구매할 박스 수량
     * @param {string} code - 레퍼럴 코드 (기본값: refCode)
     * @returns {Promise<bigint>} 총 가격 (USDT 최소 단위)
     */
    async function estimated(qty, code = refCode) {
        return await vesting.estimatedTotalAmount(qty, code);
    }

    /**
     * @notice 박스 구매 실행 및 이벤트 발생 확인
     * @param {Object} from - 구매자 계정
     * @param {bigint} qty - 구매할 박스 수량
     * @param {string} code - 레퍼럴 코드 (기본값: refCode)
     * @returns {Promise<bigint>} 실제 지불된 금액
     */
    async function buyBox(from, qty, code = refCode) {
        const est = await estimated(qty, code);
        const p = makePermit(est);
        await expect(vesting.connect(from).buyBox(qty, code, p))
            .to.emit(vesting, "BoxesPurchased");
        return est;
    }

    /**
     * @notice 과거 구매 데이터 백필 (테스트용)
     * @param {bigint} count - 백필할 박스 수량
     * @param {bigint} atTs - 구매 시점 (타임스탬프)
     * @param {string} code - 레퍼럴 코드 (기본값: refCode)
     * @param {boolean} creditBuyback - 바이백 적립 여부 (기본값: false)
     * @description 
     *  refCodeStr 비우면 레퍼럴 없는 구매가 되어 today/referralsAddedPerDay에 안 잡힙니다.
     */
    async function backfill(count, atTs, code = refCode, creditBuyback = false) {
        await vesting.connect(owner).backfillPurchaseAt(
            other.address, code, count, atTs, 1_000n, creditBuyback
        );
    }

    /**
     * @notice 베스팅 시스템 동기화 실행
     * @description 
     *  fixture의 start=현재 블록이므로, 하루가 지나야 sync가 진행됩니다.
     */
    async function syncAll() {
        await vesting.sync();
    }

    // =============================================================================
    // 기본 가격 정책 검증 테스트
    // =============================================================================

    /**
     * @test 첫 박스 가격은 350 USDT
     * @description 
     *  - 초기 티어에서 단일 박스 구매 시 가격 검증
     *  - 기본 가격 정책의 정확성 확인
     */
    it("첫 박스 가격은 350 USDT", async () => {
        const price = await estimated(1);
        expect(price).to.equal(350n * ONE_USDT);
    });

    /**
     * @test 초기 티어에서 대량구매는 단순합: 200개 = 200 * 350
     * @description 
     *  - 초기 티어(1-3199개)에서의 대량 구매 가격 계산 검증
     *  - 단순 곱셈으로 가격이 계산되는지 확인
     */
    it("초기 티어에서 대량구매는 단순합: 200개 = 200 * 350", async () => {
        const price = await estimated(200);
        expect(price).to.equal(200n * 350n * ONE_USDT);
    });

    // =============================================================================
    // 티어 경계 가격 전환 검증 테스트
    // =============================================================================

    /**
     * @test 티어 경계(3199→3200) 전환: 3199개 판매 후 다음 1개는 375 USDT
     * @description 
     *  - 3199개 판매 후 3200번째 박스부터 중간 티어 가격 적용
     *  - 티어 경계에서의 가격 전환 로직 정확성 검증
     * 
     * 테스트 단계:
     *  1. start 시각(day=0)에 3199개 백필
     *  2. 하루 경과시켜 sync 가능하게 하고 확정
     *  3. index=3200 → 375 USDT 가격 확인
     *  4. buyBox도 같은 값으로 통과하는지 검증
     */
    it("티어 경계(3199→3200) 전환: 3199개 판매 후 다음 1개는 375 USDT", async () => {
        // === start 시각(day=0)에 3199개 백필 ===
        await backfill(3199n, start);

        // === 하루 경과시켜 sync 가능하게 하고 확정 ===
        await increaseTime(DAY + 1n);
        await syncAll();

        // === 이제 index=3200 → 375 USDT ===
        const price = await estimated(1);
        expect(price).to.equal(375n * ONE_USDT);

        // === buyBox도 같은 값이어야 통과 ===
        const est = await buyBox(buyer, 1);
        expect(est).to.equal(375n * ONE_USDT);
    });

    /**
     * @test 단일 구매로 경계를 넘는 경우: 3190개 판매 상태에서 15개 구매 → 9*350 + 6*375
     * @description 
     *  - 티어 경계를 넘는 구매에서 혼합 가격 계산 정확성 검증
     *  - 3190개 상태에서 15개 구매 시 9개는 350 USDT, 6개는 375 USDT
     * 
     * 가격 계산:
     *  - 3190개 → 3200개: 10개 (3190-3200) → 9개는 350 USDT
     *  - 3200개 → 3205개: 5개 (3200-3205) → 5개는 375 USDT
     *  - 총 15개 구매: 9*350 + 6*375
     */
    it("단일 구매로 경계를 넘는 경우: 3190개 판매 상태에서 15개 구매 → 9*350 + 6*375", async () => {
        // === 3190개 판매 상태 설정 ===
        await backfill(3190n, start);
        await increaseTime(DAY + 1n);
        await syncAll();

        // === 혼합 가격 계산 검증 ===
        const price = await estimated(15);
        const expected = (9n * 350n + 6n * 375n) * ONE_USDT;
        expect(price).to.equal(expected);

        // === 실제 구매 실행 및 검증 ===
        await buyBox(buyer, 15);
    });

    // =============================================================================
    // 상한 티어 가격 검증 테스트
    // =============================================================================

    /**
     * @test 상한 구간: 9999개 판매 후 가격은 1300 USDT 고정
     * @description 
     *  - 10000개 이상 구매 시 상한 티어 가격(1300 USDT) 적용
     *  - 상한 티어에서의 가격 고정 및 일관성 검증
     * 
     * 테스트 시나리오:
     *  1. 9999개 판매 상태 설정
     *  2. 단일 박스 및 다중 박스 가격 검증
     *  3. 실제 구매 실행 및 검증
     */
    it("상한 구간: 9999개 판매 후 가격은 1300 USDT 고정", async () => {
        // === 9999개 판매 상태 설정 ===
        await backfill(9999n, start + DAY);  // day=1 등에 백필
        await increaseTime(DAY * 2n + 1n);   // 충분히 경과
        await syncAll();

        // === 단일 박스 가격 검증 ===
        const p1 = await estimated(1);
        expect(p1).to.equal(1300n * ONE_USDT);

        // === 다중 박스 가격 검증 ===
        const p10 = await estimated(10);
        expect(p10).to.equal(10n * 1300n * ONE_USDT);

        // === 실제 구매 실행 및 검증 ===
        await buyBox(buyer, 3); // 3 * 1300
    });

    // =============================================================================
    // buyBox 보안 기능 검증 테스트
    // =============================================================================

    /**
     * @test buyBox는 p.value 불일치 시 revert
     * @description 
     *  - permit의 value와 estimatedTotalAmount가 일치하지 않을 때 에러 발생 확인
     *  - 가격 조작 방지를 위한 보안 기능 검증
     * 
     * 보안 목적:
     *  - 사용자가 실제 가격보다 적게 지불하려는 시도 방지
     *  - 시스템의 경제적 균형 보장
     *  - 가격 정책의 무결성 유지
     */
    it("buyBox는 p.value 불일치 시 revert", async () => {
        const est = await estimated(2); // 2*350
        const wrong = est + 1n; // 실제 가격보다 1 USDT 적게 설정
        const p = { ...makePermit(est), value: wrong };
        
        // === 가격 불일치 시 에러 발생 확인 ===
        await expect(
            vesting.connect(buyer).buyBox(2, refCode, p)
        ).to.be.revertedWith("The amount to be paid is incorrect.");
    });

    // =============================================================================
    // 연속 구매 가격 계산 검증 테스트
    // =============================================================================

    /**
     * @test 같은 날 연속 구매: 첫 구매 후 오늘 카운터가 반영되어 다음 견적이 맞게 계산
     * @description 
     *  - 같은 날에 연속으로 구매할 때 가격 계산의 정확성 검증
     *  - 첫 구매 후 카운터가 즉시 반영되어 다음 견적이 정확하게 계산되는지 확인
     * 
     * 테스트 시나리오:
     *  1. 첫 번째 1개 구매 (350 USDT)
     *  2. 같은 날 바로 5개 견적 (아직 3199 언더라서 5*350)
     *  3. 실제 5개 구매 실행
     */
    it("같은 날 연속 구매: 첫 구매 후 오늘 카운터가 반영되어 다음 견적이 맞게 계산", async () => {
        // === 첫 번째 1개 구매 ===
        const first = await buyBox(buyer, 1);
        expect(first).to.equal(350n * ONE_USDT);

        // === 같은 날 바로 5개 견적 ===
        // 아직 3199 언더라서 5*350
        const priceNext = await estimated(5);
        expect(priceNext).to.equal(5n * 350n * ONE_USDT);

        // === 실제 5개 구매 실행 ===
        await buyBox(buyer, 5);
    });

    // =============================================================================
    // 레퍼럴 코드 유효성 검증 테스트
    // =============================================================================

    /**
     * @test 유효하지 않은 코드: estimatedTotalAmount=0, buyBox는 'refferal code not found'로 revert
     * @description 
     *  - 할당되지 않은 레퍼럴 코드로 구매 시도 시 에러 처리 검증
     *  - estimatedTotalAmount가 0을 반환하는지 확인
     *  - buyBox에서 적절한 에러 메시지와 함께 revert되는지 확인
     * 
     * 보안 목적:
     *  - 유효하지 않은 레퍼럴 코드 사용 방지
     *  - 시스템의 무결성 보장
     *  - 사용자에게 명확한 에러 메시지 제공
     */
    it("유효하지 않은 코드: estimatedTotalAmount=0, buyBox는 'refferal code not found'로 revert", async () => {
        const bad = "ZZZZZZZ1"; // 미할당된 레퍼럴 코드
        
        // === estimatedTotalAmount가 0을 반환하는지 확인 ===
        const est = await vesting.estimatedTotalAmount(1, bad);
        expect(est).to.equal(0n);

        // === buyBox에서 에러 발생 확인 ===
        const p = makePermit(0n);
        await expect(
            vesting.connect(buyer).buyBox(1, bad, p)
        ).to.be.revertedWith("refferal code not found");
    });
});
