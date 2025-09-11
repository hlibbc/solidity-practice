// test/vesting.buyback.test.js
/**
 * @fileoverview 
 *  TokenVesting 컨트랙트의 추천인 바이백(수수료 환급) 기능 테스트
 * @description 
 *  - 실제 구매(buyBox)로 10% 바이백 적립 확인
 *  - claimBuyback 호출 시 전송/이벤트/상태 초기화 검증
 *  - (주의) 최신 컨트랙트는 backfill에서 바이백 적립하지 않음 → buyBox 사용
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployFixture } = require("./helpers/vestingFixture");

describe("vesting.buyback", function () {
    it("적립 후 claimBuyback 전송/이벤트/상태 초기화", async () => {
        // === 테스트 환경 ===
        const { owner, vesting, stableCoin, buyer, referrer, seedReferralFor } = await deployFixture();

        // recipient 미설정이면 buyBox에서 먼저 revert 되므로 사전 세팅
        await vesting.connect(owner).setRecipient(owner.address);

        // 레퍼럴 코드 세팅
        const refCode = await seedReferralFor(referrer);

        // 1박스 구매 견적
        const boxCount = 1n;
        const estimated = await vesting.estimatedTotalAmount(boxCount, refCode);
        expect(estimated).to.be.gt(0n);

        // buyer에 잔액 확보
        if (stableCoin.mint) {
            await stableCoin.mint(buyer.address, estimated);
        } else {
            await stableCoin.connect(owner).transfer(buyer.address, estimated);
        }

        // approve 경로 사용(deadline=0), value는 내부 비교값과 동일해야 함
        await stableCoin.connect(buyer).approve(await vesting.getAddress(), estimated);
        const pSkip = { value: estimated, deadline: 0n, v: 0, r: ethers.ZeroHash, s: ethers.ZeroHash };

        // === 실제 구매 수행 → 컨트랙트에 10%가 남고, 나머지는 recipient로 전송됨
        await expect(vesting.connect(buyer).buyBox(boxCount, refCode, pSkip))
            .to.emit(vesting, "BoxesPurchased");

        // 예상 바이백 금액(결제액의 BUYBACK_PERCENT %)
        const percent = BigInt(await vesting.BUYBACK_PERCENT());
        const expected = (estimated * percent) / 100n;

        // 컨트랙트 보유 USDT = 적립된 바이백 금액
        const contractBal = await stableCoin.balanceOf(await vesting.getAddress());
        expect(contractBal).to.equal(expected);

        // === 청구 전/후 잔액 비교 + 이벤트 검증
        const before = await stableCoin.balanceOf(referrer.address);
        await expect(vesting.connect(referrer).claimBuyback())
            .to.emit(vesting, "BuybackClaimed")
            .withArgs(referrer.address, expected);
        const after = await stableCoin.balanceOf(referrer.address);
        expect(after - before).to.equal(expected);

        // === 중복 청구 방지
        await expect(vesting.connect(referrer).claimBuyback()).to.be.revertedWith("nothing");
    });
});
