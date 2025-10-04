// test/vesting.sendBox.test.js
/**
 * @fileoverview
 *  TokenVesting 컨트랙트의 박스 소유권 이전 기능(sendBox) 테스트
 * @description
 *  - onlyOwner 전용 실행 검증
 *  - 정상 이전 시 from/to 보유량 변경 검증 및 이벤트 확인
 *  - 총 구매량(getTotalBoxPurchased)이 불변임을 확인
 *  - 유효성 검사(0 주소/동일 주소/수량 0) 및 보유량 부족 에러 검증
 *
 * 테스트 포인트 요약:
 *  - sendBox는 구매량 기록/분모에는 영향을 주지 않으며, 당일(effDay=today)부터 보유량이 변경됩니다.
 */

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployFixture } = require("./helpers/vestingFixture");

/**
 * @notice permit 스킵용 헬퍼 (approve 경로 사용)
 * @param {bigint} value 필요 금액(estimate와 일치 값 권장)
 */
function makePermitSkip(value = 0n) {
    return { value, deadline: 0n, v: 0, r: ethers.ZeroHash, s: ethers.ZeroHash };
}

describe("vesting.sendBox", function () {
    it("정상 이전: owner가 from→to로 이전하면 보유량 반영, 이벤트 발생, 총 구매량 불변", async () => {
        // === 준비: 배포/레퍼럴/recipient 설정 ===
        const { owner, buyer, referrer, vesting, stableCoin, seedReferralFor } = await deployFixture();
        const to = (await ethers.getSigners())[2];
        const refCode = await seedReferralFor(referrer);
        await vesting.connect(owner).setRecipient(owner.address);

        // === 구매: buyer가 3박스 구매(approve 경로) ===
        const boxCount = 3n;
        const need = await vesting.estimatedTotalAmount(boxCount, refCode);
        expect(need).to.be.gt(0n);

        if (stableCoin.mint) {
            await stableCoin.mint(buyer.address, need);
        } else {
            await stableCoin.connect(owner).transfer(buyer.address, need);
        }
        await stableCoin.connect(buyer).approve(await vesting.getAddress(), ethers.MaxUint256);
        await expect(
            vesting.connect(buyer).buyBox(boxCount, refCode, makePermitSkip(need))
        ).to.emit(vesting, "BoxesPurchased");

        // === sendBox 실행 전 상태 ===
        const totalBefore = await vesting.getTotalBoxPurchased();
        const beforeFrom = await vesting.boxesOf(buyer.address);
        const beforeTo = await vesting.boxesOf(to.address);
        expect(beforeFrom).to.equal(boxCount);
        expect(beforeTo).to.equal(0n);

        // === sendBox: owner가 buyer→to로 1박스 이전 ===
        await expect(
            vesting.connect(owner).sendBox(buyer.address, to.address, 1n)
        ).to.emit(vesting, "BoxesTransferred");

        // === 결과 검증 ===
        const afterFrom = await vesting.boxesOf(buyer.address);
        const afterTo = await vesting.boxesOf(to.address);
        expect(afterFrom).to.equal(2n);
        expect(afterTo).to.equal(1n);

        // 총 구매량은 변하지 않아야 함
        const totalAfter = await vesting.getTotalBoxPurchased();
        expect(totalAfter).to.equal(totalBefore);
    });

    it("onlyOwner: 비owner 호출 시 실패(OwnableUnauthorizedAccount)", async () => {
        const { buyer, referrer, vesting, stableCoin, seedReferralFor, owner } = await deployFixture();
        const to = (await ethers.getSigners())[2];
        const ref = await seedReferralFor(referrer);
        await vesting.connect(owner).setRecipient(owner.address);

        const need = await vesting.estimatedTotalAmount(1n, ref);
        if (stableCoin.mint) {
            await stableCoin.mint(buyer.address, need);
        } else {
            await stableCoin.connect(owner).transfer(buyer.address, need);
        }
        await stableCoin.connect(buyer).approve(await vesting.getAddress(), ethers.MaxUint256);
        await vesting.connect(buyer).buyBox(1n, ref, makePermitSkip(need));

        await expect(
            vesting.connect(buyer).sendBox(buyer.address, to.address, 1n)
        ).to.be.revertedWithCustomError(vesting, "OwnableUnauthorizedAccount");
    });

    it("유효성: zero addr / same addr / box=0 → revert", async () => {
        const { owner, buyer, referrer, vesting, stableCoin, seedReferralFor } = await deployFixture();
        const to = (await ethers.getSigners())[2];
        const ref = await seedReferralFor(referrer);
        await vesting.connect(owner).setRecipient(owner.address);

        const need = await vesting.estimatedTotalAmount(1n, ref);
        if (stableCoin.mint) {
            await stableCoin.mint(buyer.address, need);
        } else {
            await stableCoin.connect(owner).transfer(buyer.address, need);
        }
        await stableCoin.connect(buyer).approve(await vesting.getAddress(), ethers.MaxUint256);
        await vesting.connect(buyer).buyBox(1n, ref, makePermitSkip(need));

        await expect(
            vesting.connect(owner).sendBox(ethers.ZeroAddress, to.address, 1n)
        ).to.be.revertedWith("zero addr");

        await expect(
            vesting.connect(owner).sendBox(buyer.address, ethers.ZeroAddress, 1n)
        ).to.be.revertedWith("zero addr");

        await expect(
            vesting.connect(owner).sendBox(buyer.address, buyer.address, 1n)
        ).to.be.revertedWith("same addr");

        await expect(
            vesting.connect(owner).sendBox(buyer.address, to.address, 0n)
        ).to.be.revertedWith("box=0");
    });

    it("보유량 부족: 이전 수량 > 보유량 → InsufficientAfterPriorTransfers", async () => {
        const { owner, buyer, referrer, vesting, stableCoin, seedReferralFor } = await deployFixture();
        const to = (await ethers.getSigners())[2];
        const ref = await seedReferralFor(referrer);
        await vesting.connect(owner).setRecipient(owner.address);

        const need = await vesting.estimatedTotalAmount(1n, ref);
        if (stableCoin.mint) {
            await stableCoin.mint(buyer.address, need);
        } else {
            await stableCoin.connect(owner).transfer(buyer.address, need);
        }
        await stableCoin.connect(buyer).approve(await vesting.getAddress(), ethers.MaxUint256);
        await vesting.connect(buyer).buyBox(1n, ref, makePermitSkip(need));

        // 1개 보유 상태에서 2개 이전 시도 → custom error
        await expect(
            vesting.connect(owner).sendBox(buyer.address, to.address, 2n)
        ).to.be.revertedWithCustomError(vesting, "InsufficientAfterPriorTransfers");
    });

    it("효력일 검증: 전일 보상 불변, 당일부터 반영 + 동기화", async () => {
        const { owner, buyer, referrer, vesting, stableCoin, seedReferralFor, DAY, increaseTime } = await deployFixture();
        const to = (await ethers.getSigners())[3];
        const ref = await seedReferralFor(referrer);
        await vesting.connect(owner).setRecipient(owner.address);

        // 1) day0에 3박스 구매
        const boxCount = 3n;
        const need = await vesting.estimatedTotalAmount(boxCount, ref);
        if (stableCoin.mint) {
            await stableCoin.mint(buyer.address, need);
        } else {
            await stableCoin.connect(owner).transfer(buyer.address, need);
        }
        await stableCoin.connect(buyer).approve(await vesting.getAddress(), ethers.MaxUint256);
        await vesting.connect(buyer).buyBox(boxCount, ref, { value: need, deadline: 0n, v: 0, r: ethers.ZeroHash, s: ethers.ZeroHash });

        // 2) 하루 경과 → day0 확정(sync 1일)
        await increaseTime(DAY);
        await vesting.connect(owner).syncLimitDay(1);

        // day index 계산
        const start = (await vesting.vestingStartDate());
        const nowTs = BigInt((await ethers.provider.getBlock("latest")).timestamp);
        const dToday = (nowTs - start) / DAY; // == 1

        // 3) 이전 전 상태 확인: day0=3, day1(오늘)=3
        const b0_before = await vesting.buyerBoxesAtDay(buyer.address, dToday - 1n);
        const b1_before = await vesting.buyerBoxesAtDay(buyer.address, dToday);
        expect(b0_before).to.equal(3n);
        expect(b1_before).to.equal(3n);

        // 4) 오늘(day1)에 1박스 sendBox → effDay = today
        await vesting.connect(owner).sendBox(buyer.address, to.address, 1n);

        // 5) 반영 확인: day0 불변(3), day1은 2로 감소 / to는 day1부터 1
        const b0_after = await vesting.buyerBoxesAtDay(buyer.address, dToday - 1n);
        const b1_after = await vesting.buyerBoxesAtDay(buyer.address, dToday);
        const t0_after = await vesting.buyerBoxesAtDay(to.address, dToday - 1n);
        const t1_after = await vesting.buyerBoxesAtDay(to.address, dToday);
        expect(b0_after).to.equal(3n);
        expect(b1_after).to.equal(2n);
        expect(t0_after).to.equal(0n);
        expect(t1_after).to.equal(1n);

        // 6) 오늘(day1) 이후에야 동기화 가능 → 하루 경과 후 동기화 1일 진행
        await increaseTime(DAY);
        await vesting.connect(owner).syncLimitDay(1);
        const b1_after_sync = await vesting.buyerBoxesAtDay(buyer.address, dToday);
        const t1_after_sync = await vesting.buyerBoxesAtDay(to.address, dToday);
        expect(b1_after_sync).to.equal(2n);
        expect(t1_after_sync).to.equal(1n);
    });
});


