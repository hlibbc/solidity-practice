// test/vesting.withdraw.test.js
/**
 * @fileoverview
 *  TokenVesting: StableCoin 인출 로직 테스트
 * @description
 *  - 신규 구현된 totalStableCoinAmount(), withdrawStableCoinForced() 검증
 *  - 시나리오:
 *    1) 박스 구매 후 totalStableCoinAmount 확인
 *    2) 즉시 withdrawStableCoinForced는 실패(관리자/일반 사용자 모두)
 *    3) 4년차 베스팅 종료시각까지 이동 후에도 실패(관리자/일반 사용자)
 *    4) 추가로 90일 경과 후: 사용자 실패, 관리자 성공 → 이후 totalStableCoinAmount=0 확인
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployFixture } = require("./helpers/vestingFixture");

describe("vesting.withdraw", function () {
    it("구매 → 인출 대기기간 로직 검증", async () => {
        // === 픽스처 ===
        const {
            owner,
            buyer,
            referrer,
            other,
            vesting,
            stableCoin,
            start,
            DAY,
            seedReferralFor,
            increaseTime,
        } = await deployFixture();

        // recipient 미설정 시 buyBox revert → 사전 세팅
        await vesting.connect(owner).setRecipient(owner.address);

        // 레퍼럴 세팅 및 1박스 구매 견적
        const refCode = await seedReferralFor(referrer);
        const box = 1n;
        const price = await vesting.estimatedTotalAmount(box, refCode);
        expect(price).to.be.gt(0n);

        // buyer 잔액/승인 준비
        if (stableCoin.mint) {
            await stableCoin.mint(buyer.address, price);
        } else {
            await stableCoin.connect(owner).transfer(buyer.address, price);
        }
        await stableCoin.connect(buyer).approve(await vesting.getAddress(), price);
        const pSkip = { value: price, deadline: 0n, v: 0, r: ethers.ZeroHash, s: ethers.ZeroHash };

        // === 구매 실행
        await expect(vesting.connect(buyer).buyBox(box, refCode, pSkip))
            .to.emit(vesting, "BoxesPurchased");

        // 컨트랙트 누적 수령 StableCoin 확인 (totalStableCoinAmount)
        const total0 = await vesting.totalStableCoinAmount();
        expect(total0).to.be.gt(0n);

        // === 즉시 강제 인출은 실패 (대기기간 전)
        await expect(vesting.connect(buyer).withdrawStableCoinForced(buyer.address)).to.be.reverted;
        await expect(vesting.connect(owner).withdrawStableCoinForced(owner.address)).to.be.reverted;

        // === 4년차 종료시각까지 이동
        // deployFixture의 ends[3]는 4년차(inclusive) 종료시각 - start 기준 오프셋
        // 여기선 상대시간 증가로 근사: 4년(365*4일) 경과
        await increaseTime(DAY * 365n * 4n);
        await expect(vesting.connect(buyer).withdrawStableCoinForced(buyer.address)).to.be.reverted;
        await expect(vesting.connect(owner).withdrawStableCoinForced(owner.address)).to.be.reverted;

        // === 추가 90일 경과 후: 사용자 실패, 관리자 성공
        await increaseTime(DAY * 90n);
        await expect(vesting.connect(buyer).withdrawStableCoinForced(buyer.address)).to.be.reverted;

        // 인출 받을 대상: owner가 아닌 다른 주소로 지정
        const to = other.address;
        const vestingAddr = await vesting.getAddress();
        const withdrawable = await stableCoin.balanceOf(vestingAddr);
        expect(withdrawable).to.be.gt(0n);

        const balBeforeTo = await stableCoin.balanceOf(to);
        const tx = await vesting.connect(owner).withdrawStableCoinForced(to);
        await tx.wait();
        const balAfterTo = await stableCoin.balanceOf(to);
        expect(balAfterTo - balBeforeTo).to.equal(withdrawable);

        // === 인출 후 잔액/상태 확인
        const total1 = await vesting.totalStableCoinAmount();
        expect(total1).to.equal(0n);
    });
});


