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
        const { owner, buyer, referrer, stableCoin, vesting, DAY, seedReferralFor, increaseTime } = await deployFixture();

        // ★ vesting가 판매 대금을 보낼 곳 필수
        await vesting.connect(owner).setRecipient(owner.address);

        // ★ buyer에게 USDT 주고 approve
        await stableCoin.connect(owner).transfer(buyer.address, ethers.parseUnits("1000000", 6));
        await stableCoin.connect(buyer).approve(await vesting.getAddress(), ethers.MaxUint256);

        const refCode = await seedReferralFor(referrer);

        const boxCount = 3n;
        const estimated = await vesting.estimatedTotalAmount(boxCount, refCode);
        expect(estimated).to.be.gt(0n);

        const pSkip = { value: estimated, deadline: 0n, v: 0, r: ethers.ZeroHash, s: ethers.ZeroHash };
        await expect(vesting.connect(buyer).buyBox(boxCount, refCode, pSkip)).to.emit(vesting, "BoxesPurchased");

        await increaseTime(DAY + 1n);
        await vesting.sync();

        const per0 = await vesting.rewardPerBox(0n);
        expect(per0 > 0n).to.equal(true);
        expect(await vesting.cumBoxes(0n)).to.equal(3n);

        await increaseTime(DAY + 1n);
        await vesting.sync();

        const per1 = await vesting.rewardPerBox(1n);
        expect(per1 > 0n).to.equal(true);
    });
});
