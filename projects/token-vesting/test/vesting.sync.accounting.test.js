// test/vesting.sync.accounting.test.js
/**
 * @fileoverview 
 *  TokenVesting 컨트랙트의 동기화(sync) 회계 로직 테스트
 * @description
 *  - 베스팅 시작일(d=0)과 그 이후 날짜들의 보상 계산 로직 검증
 *  - 분모(denominator) 반영 시점과 보상 계산 정확성 확인
 *  - 일별 보상 단가(rewardPerBox)와 누적 박스 수(cumBoxes)의 변화 추적
 * 
 * 테스트 목적:
 *  - 베스팅 시스템의 동기화 회계 로직 정확성 검증
 *  - 일별 보상 계산 메커니즘의 정상 동작 확인
 *  - 분모 설정 시점과 보상 단가 계산의 일관성 검증
 *  - 베스팅 시작일부터의 보상 시스템 동작 검증
 * 
 * 동기화 회계 시스템 개요:
 *  - 베스팅 시작일(d=0)부터 일별로 보상 계산 진행
 *  - 각 날짜별로 보상 단가(rewardPerBox)와 누적 박스 수(cumBoxes) 계산
 *  - 분모는 이전 날짜의 누적 데이터를 기반으로 설정
 *  - 일별 보상 계산의 정확성과 일관성 보장
 * 
 * @author hlibbc
 */
const { expect } = require("chai");
const { ethers } = require("hardhat"); // ★ 추가
const { deployFixture } = require("./helpers/vestingFixture");

// =============================================================================
// 베스팅 동기화 회계 로직 테스트
// =============================================================================

/**
 * @describe 베스팅 동기화 회계 로직 테스트
 * @description
 *  1. 베스팅 시작일(d=0)에서의 보상 계산 로직 검증
 *  2. d=1부터 분모가 cumBoxes[0]로 설정되는 로직 확인
 *  3. 일별 보상 단가와 누적 데이터의 정확성 검증
 * 
 * 테스트 시나리오:
 *  - 베스팅 시작일(d=0)에서의 구매 및 보상 계산
 *  - 1일 경과 후 d=0 확정 및 보상 단가 검증
 *  - 2일 경과 후 d=1 확정 및 분모 설정 검증
 * 
 * 검증 항목:
 *  - d=0에서의 보상 단가 계산 정확성
 *  - d=1에서의 분모 설정 정확성
 *  - 누적 박스 수의 정확한 계산
 *  - 일별 보상 단가의 변화 추적
 */
describe("vesting.sync.accounting", function () {

    // =============================================================================
    // 베스팅 시작일 및 분모 반영 로직 테스트
    // =============================================================================

    /**
     * @test effDay/분모 반영: d=0 보상>0(정책 변경), d=1부터 분모=cumBoxes[0]
     * @description
     *  - (정책 변경 반영) d=0 판매는 d=0부터 바로 보상에 반영됨
     *  - d=0의 분모는 (이전 누적 + d=0 당일 추가분) → 당일 판매가 있으면 perBox[0] > 0
     *  - d=1부터는 분모가 cumBoxes[0]로 고정되어 다음 날 보상 계산 진행
     * 
     * 베스팅 시작일(d=0) 보상 계산 로직:
     *  - d=0에서 구매한 박스는 당일부터 보상 계산에 반영
     *  - 분모 = 이전 누적(0) + 당일 추가분(boxesAddedPerDay[0])
     *  - 보상 단가 = 베스팅 토큰 수량 / 분모
     * 
     * d=1 이후 보상 계산 로직:
     *  - 분모는 cumBoxes[0]로 고정 (d=0의 누적 박스 수)
     *  - 새로운 구매가 있어도 분모는 변경되지 않음
     *  - 보상 단가는 고정된 분모를 기준으로 계산
     * 
     * 테스트 단계:
     *  1. d=0에서 3개 박스 구매
     *  2. 1일 경과 후 d=0 확정 및 보상 단가 검증
     *  3. 2일 경과 후 d=1 확정 및 분모 설정 검증
     * 
     * 검증 포인트:
     *  - d=0에서의 보상 단가가 0보다 큰지
     *  - d=0의 누적 박스 수가 구매한 박스 수와 일치하는지
     *  - d=1에서의 보상 단가가 0보다 큰지
     *  - 분모 설정이 올바르게 이루어지는지
     */
    it("effDay/분모 반영: d=0 보상>0, d=1부터 분모=cumBoxes[0]", async () => {
        // === 테스트 환경 구성 ===
        const { buyer, referrer, vesting, DAY, seedReferralFor, increaseTime } = await deployFixture();

        // === referrer 코드 세팅 ===
        // seedReferralFor 함수를 통해 referrer에게 레퍼럴 코드 할당
        const refCode = await seedReferralFor(referrer);

        // === d=0에서 구매: 3개 박스 ===
        const boxCount = 3n;
        // 구매할 박스 수량에 대한 총 가격 견적 조회
        const estimated = await vesting.estimatedTotalAmount(boxCount, refCode);
        expect(estimated).to.be.gt(0n);

        // === permit 데이터 생성 (permit 미사용으로 deadline=0 설정) ===
        // permit 경로를 스킵하고 approve 기반으로 처리하기 위한 설정
        const pSkip = { 
            value: estimated,           // 견적된 총 가격
            deadline: 0n,              // permit 미사용 (0으로 설정)
            v: 0,                      // 서명 데이터 (사용하지 않음)
            r: ethers.ZeroHash,        // 서명 데이터 (사용하지 않음)
            s: ethers.ZeroHash         // 서명 데이터 (사용하지 않음)
        };
        
        // === 박스 구매 실행 및 이벤트 발생 확인 ===
        // BoxesPurchased 이벤트가 발생하는지 확인하여 구매 성공 검증
        await expect(vesting.connect(buyer).buyBox(boxCount, refCode, pSkip))
            .to.emit(vesting, "BoxesPurchased");

        // === 1일 경과 → d=0 확정 ===
        // DAY + 1n초만큼 시간을 증가시켜 하루가 지나도록 함
        await increaseTime(DAY + 1n);
        // 베스팅 시스템 동기화 실행 (d=0 확정)
        await vesting.sync();

        // === (정책 변경 반영) d=0 보상 단가 검증 ===
        // d=0: 분모 = (전일 누적 0) + (당일 추가분 boxesAddedPerDay[0]=3) → perBox[0] > 0
        // d=0에서의 보상 단가가 0보다 큰지 확인
        const per0 = await vesting.rewardPerBox(0n);
        expect(per0 > 0n).to.equal(true);

        // === 누적 박스 수 검증 ===
        // d=0의 누적 박스 수가 당일 판매 누적치(3개)와 동일한지 확인
        expect(await vesting.cumBoxes(0n)).to.equal(3n);

        // === 추가로 1일 더 경과 → d=1 확정 ===
        // 다시 하루만큼 시간을 증가시켜 d=1로 진행
        await increaseTime(DAY + 1n);
        // 베스팅 시스템 동기화 실행 (d=1 확정)
        await vesting.sync();

        // === d=1 보상 단가 검증 ===
        // d=1: 분모=cumBoxes[0]=3 → perBox[1] > 0
        // d=1에서의 보상 단가가 0보다 큰지 확인
        const per1 = await vesting.rewardPerBox(1n);
        expect(per1 > 0n).to.equal(true);
    });
});
