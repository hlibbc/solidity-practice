// test/vesting.preview.test.js
/**
 * @fileoverview 
 *  TokenVesting 컨트랙트의 보상 미리보기(preview) 기능 테스트
 * @description
 *  - 특정 시점에서의 클레임 가능한 보상 미리보기 기능 검증
 *  - sync 전후 동일한 시점 기준 미리보기 값의 일치성 확인
 *  - 구매자 풀과 추천인 풀의 미리보기 함수 정확성 검증
 * 
 * 테스트 목적:
 *  - 보상 미리보기 시스템의 정확성과 일관성 검증
 *  - sync 전후 동일한 시점에서의 미리보기 값 일치성 확인
 *  - previewBuyerClaimableAt과 previewReferrerClaimableAt 함수의 신뢰성 검증
 *  - 베스팅 시스템의 예측 가능성과 투명성 보장
 * 
 * 미리보기 시스템 개요:
 *  - 특정 시점(타임스탬프)에서의 클레임 가능한 보상을 미리 계산
 *  - sync 전후에도 동일한 시점 기준으로 일관된 결과 제공
 *  - 사용자가 언제 얼마의 보상을 받을 수 있는지 미리 확인 가능
 * 
 * @author hlibbc
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");            // ★ 추가
const { deployFixture } = require("./helpers/vestingFixture");

// =============================================================================
// 유틸리티 함수들
// =============================================================================

/**
 * @notice permit 데이터를 생성하는 헬퍼 함수
 * @param {bigint} value - 허용할 토큰 수량
 * @param {bigint} deadline - 허용 만료 시간 (0이면 permit 경로 스킵)
 * @param {number} v - 서명의 v 값 (기본값: 0)
 * @param {string} r - 서명의 r 값 (기본값: ZeroHash)
 * @param {string} s - 서명의 s 값 (기본값: ZeroHash)
 * @returns {Object} permit 데이터 객체
 * 
 * 용도: deadline=0으로 설정하면 approve 경로를 사용하고,
 *       유효한 deadline과 서명을 설정하면 permit 경로를 사용
 */
function makePermit(value, deadline = 0n, v = 0, r = ethers.ZeroHash, s = ethers.ZeroHash) {
    return { value, deadline, v, r, s };
}

// =============================================================================
// 보상 미리보기 기능 테스트 스위트
// =============================================================================

/**
 * @describe 보상 미리보기 기능 테스트
 * @description 
 *  - 특정 시점에서의 보상 미리보기 기능 검증
 *  - sync 전후 동일한 시점 기준 미리보기 값의 일치성 확인
 *  - 구매자 풀과 추천인 풀의 미리보기 함수 정확성 검증
 * 
 * 테스트 시나리오:
 *  - 베스팅 시스템 초기화 및 동기화
 *  - 레퍼럴 코드를 통한 박스 구매
 *  - 특정 시점에서의 보상 미리보기
 *  - 시간 경과 및 동기화 후 동일 시점 미리보기
 *  - 미리보기 값의 일치성 검증
 */
describe("vesting.preview", function () {
    // =============================================================================
    // sync 전후 미리보기 값 일치성 테스트
    // =============================================================================

    /**
     * @test previewBuyer/Referrer: sync 후에도 같은 ts 기준 값이 일치
     * @description
     *  - 특정 시점(ts)에서의 보상 미리보기 값을 sync 전후로 비교
     *  - sync 전후 동일한 시점 기준으로 미리보기 값이 일치하는지 확인
     *  - previewBuyerClaimableAt과 previewReferrerClaimableAt 함수의 정확성 검증
     * 
     * 테스트 단계:
     *  1. 베스팅 시스템 초기화 및 최초 동기화
     *  2. 레퍼럴 코드 설정 및 박스 구매
     *  3. 특정 시점에서의 보상 미리보기 (sync 전)
     *  4. 시간 경과 및 동기화 실행
     *  5. 동일 시점에서의 보상 미리보기 (sync 후)
     *  6. 미리보기 값의 일치성 검증
     * 
     * 예상 결과:
     *  - sync 전후 동일한 시점에서의 미리보기 값이 일치
     *  - 구매자 풀과 추천인 풀 모두에서 일관성 확인
     *  - 미리보기 시스템의 신뢰성과 예측 가능성 검증
     * 
     * 테스트의 중요성:
     *  - 사용자가 언제 얼마의 보상을 받을 수 있는지 정확하게 예측 가능
     *  - sync 전후에도 일관된 결과 제공으로 시스템의 안정성 보장
     *  - 미리보기 기능의 정확성은 사용자 경험과 시스템 신뢰성에 직접적 영향
     */
    it("previewBuyer/Referrer: sync 후에도 같은 ts 기준 값이 일치", async () => {
        // === 테스트 환경 설정 ===
        const {
            buyer, referrer, vesting, stableCoin,  // ★ stableCoin도 가져옴
            start, DAY, seedReferralFor, increaseTime
        } = await deployFixture();

        // === 최초 sync 수행 ===
        // 베스팅 시작일로부터 하루가 지나면 d=0일이 확정됨
        await increaseTime(DAY + 1n);
        await vesting.sync();

        // === 레퍼럴 코드 설정 ===
        // referrer 사용자에게 고유한 레퍼럴 코드 할당
        const refCode = await seedReferralFor(referrer);

        // === buyer가 미리 approve 설정 ===
        // 전송액 0이어도 안전하게 허용치 부여
        // 실제 구매 시 transferFrom이 정상적으로 작동하도록 준비
        await stableCoin.connect(buyer).approve(await vesting.getAddress(), ethers.MaxUint256);

        // === 박스 구매: 2개 박스를 referrer의 코드로 구매 ===
        const boxCount = 2n;
        
        // ★ 견적 구해서 유효성 확인
        const estimated = await vesting.estimatedTotalAmount(boxCount, refCode);
        expect(estimated).to.be.gt(0n); // 레퍼럴 코드가 유효한지 확인
        
        // ★ p.value=estimated로 permit 데이터 생성
        const pSkip = makePermit(estimated, 0n); // deadline=0 → approve 경로 사용

        // 박스 구매 실행 및 BoxesPurchased 이벤트 발생 확인
        await expect(vesting.connect(buyer).buyBox(boxCount, refCode, pSkip))
            .to.emit(vesting, "BoxesPurchased");

        // === 2일 뒤 시점(ts)을 기준으로 미리보기 (sync 전) ===
        // 베스팅 시작일로부터 2일 후 시점을 기준으로 미리보기
        const ts = start + DAY * 2n;
        const prevBuyer = await vesting.previewBuyerClaimableAt(buyer.address, ts);
        const prevRef   = await vesting.previewReferrerClaimableAt(referrer.address, ts);

        // === 실제로 2일 경과 + sync ===
        // 현재 블록 타임스탬프를 기준으로 필요한 시간만큼 진행
        const now = BigInt((await ethers.provider.getBlock("latest")).timestamp);
        const delta = ts - now + 1n; // +1s 여유 시간 추가
        await increaseTime(delta);
        await vesting.sync(); // d=2일까지 동기화 완료

        // === 같은 ts로 다시 미리보기 → 동일해야 함 ===
        // sync 후에도 동일한 시점에서의 미리보기 값이 일치하는지 확인
        const afterBuyer = await vesting.previewBuyerClaimableAt(buyer.address, ts);
        const afterRef   = await vesting.previewReferrerClaimableAt(referrer.address, ts);

        // === 미리보기 값의 일치성 검증 ===
        // sync 전후 동일한 시점에서의 미리보기 값이 정확히 일치하는지 확인
        expect(afterBuyer).to.equal(prevBuyer);
        expect(afterRef).to.equal(prevRef);
    });
});
