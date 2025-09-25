// test/vesting.pricing.test.js
/**
 * @fileoverview
 *  TokenVesting 컨트랙트의 가격 정책 및 buyBox 금액 검증 테스트
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployFixture } = require("./helpers/vestingFixture");

// USDT 6dec
const ONE_USDT = 10n ** 6n;

describe("TokenVesting - pricing & buyBox amount check (using vestingFixture)", function () {
    let owner, buyer, referrer, other;
    let stableCoin, vesting, start, increaseTime, seedReferralFor, DAY;
    let refCode;

    // ─────────────────────────────────────────────────────────────────────────
    // 유틸
    // ─────────────────────────────────────────────────────────────────────────
    function hasFn(ctr, name) {
        return ctr.interface.fragments.some(f => f.type === "function" && f.name === name);
    }

    function makePermit(value) {
        // permit 생략 경로를 사용하기 위해 deadline=0
        return { value, deadline: 0n, v: 0, r: ethers.ZeroHash, s: ethers.ZeroHash };
    }

    async function estimated(qty, code = refCode) {
        return vesting.estimatedTotalAmount(qty, code);
    }

    async function buyBox(from, qty, code = refCode) {
        const est = await estimated(qty, code);
        const p = makePermit(est);
        await expect(vesting.connect(from).buyBox(qty, code, p)).to.emit(vesting, "BoxesPurchased");
        return est;
    }

    async function syncAll() {
        await vesting.sync();
    }

    /**
     * ✅ 컨트랙트 시그니처에 정확히 맞춘 백필
     * TokenVesting.BackfillPurchase:
     *   address buyer;
     *   string  refCodeStr;
     *   uint256 boxCount;
     *   uint256 purchaseTs;
     *   uint256 paidUnits;
     */
    async function backfill(count, atTs, code = refCode) {
        const item = {
            buyer:      other.address,
            refCodeStr: code,
            boxCount:   count,
            purchaseTs: atTs,
            paidUnits:  1_000n, // 테스트 더미 값
        };
        await vesting.connect(owner).backfillPurchaseBulkAt([item]);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 준비
    // ─────────────────────────────────────────────────────────────────────────
    beforeEach(async () => {
        ({
            owner, buyer, referrer, other,
            stableCoin, vesting, start, increaseTime, seedReferralFor, DAY
        } = await deployFixture());

        // recipient 필수
        if (hasFn(vesting, "setRecipient")) {
            await vesting.connect(owner).setRecipient(owner.address);
        }

        // 유효한 레퍼럴 코드 생성
        refCode = await seedReferralFor(referrer);

        // 구매자 잔고/승인
        await stableCoin.connect(owner).transfer(buyer.address, 1_000_000n * ONE_USDT);
        await stableCoin.connect(buyer).approve(await vesting.getAddress(), ethers.MaxUint256);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 테스트
    // ─────────────────────────────────────────────────────────────────────────
    it("첫 박스 가격은 350 USDT", async () => {
        const price = await estimated(1);
        expect(price).to.equal(350n * ONE_USDT);
    });

    it("초기 티어에서 대량구매는 단순합: 200개 = 200 * 350", async () => {
        const price = await estimated(200);
        expect(price).to.equal(200n * 350n * ONE_USDT);
    });

    it("티어 경계(3199→3200) 전환: 3199개 판매 후 다음 1개는 375 USDT", async () => {
        await backfill(3199n, start);
        await increaseTime(DAY + 1n);
        await syncAll();

        const price = await estimated(1);
        expect(price).to.equal(375n * ONE_USDT);

        const est = await buyBox(buyer, 1);
        expect(est).to.equal(375n * ONE_USDT);
    });

    it("단일 구매로 경계를 넘는 경우: 3190개 판매 상태에서 15개 구매 → 9*350 + 6*375", async () => {
        await backfill(3190n, start);
        await increaseTime(DAY + 1n);
        await syncAll();

        const price = await estimated(15);
        const expected = (9n * 350n + 6n * 375n) * ONE_USDT;
        expect(price).to.equal(expected);

        await buyBox(buyer, 15);
    });

    it("상한 구간: 9999개 판매 후 가격은 1300 USDT 고정", async () => {
        await backfill(9999n, start + DAY);
        await increaseTime(DAY * 2n + 1n);
        await syncAll();

        const p1 = await estimated(1);
        expect(p1).to.equal(1300n * ONE_USDT);

        const p10 = await estimated(10);
        expect(p10).to.equal(10n * 1300n * ONE_USDT);

        await buyBox(buyer, 3);
    });

    it("buyBox는 p.value 불일치 시 revert", async () => {
        const est = await estimated(2);
        const wrong = est + 1n;
        const p = { ...makePermit(est), value: wrong };
        await expect(
            vesting.connect(buyer).buyBox(2, refCode, p)
        ).to.be.revertedWith("The amount to be paid is incorrect.");
    });

    it("같은 날 연속 구매: 첫 구매 후 오늘 카운터가 반영되어 다음 견적이 맞게 계산", async () => {
        const first = await buyBox(buyer, 1);
        expect(first).to.equal(350n * ONE_USDT);

        const priceNext = await estimated(5);
        expect(priceNext).to.equal(5n * 350n * ONE_USDT);

        await buyBox(buyer, 5);
    });

    it("유효하지 않은 코드: estimatedTotalAmount=0, buyBox는 'referral code not found'로 revert", async () => {
        const bad = "ZZZZZZZ1";
        const est = await vesting.estimatedTotalAmount(1, bad);
        expect(est).to.equal(0n);

        const p = makePermit(0n);
        await expect(
            vesting.connect(buyer).buyBox(1, bad, p)
        ).to.be.revertedWith("referral code not found");
    });
    // ─────────────────────────────────────────────────────────────────────────
    // Referral discount tests
    // ─────────────────────────────────────────────────────────────────────────
    describe("TokenVesting - referral discount", function () {
        it("setReferralDiscount: onlyOwner가 아니면 revert(OwnableUnauthorizedAccount)", async function () {
            // owner가 아닌 buyer가 시도
            await expect(
                vesting.connect(buyer).setReferralDiscount(refCode, 10n)
            ).to.be.revertedWithCustomError(vesting, "OwnableUnauthorizedAccount")
            .withArgs(buyer.address);
        });

        it("setReferralDiscount: 존재하지 않는 코드면 'Referral is not exist'로 revert", async function () {
            const nonExist = "A1B2C3D4"; // 아무도 소유하지 않은 코드(8자)
            await expect(
                vesting.connect(owner).setReferralDiscount(nonExist, 5n)
            ).to.be.revertedWith("Referral is not exist");
        });

        it("setReferralDiscount: 코드 길이 오류면 'ref len!=8' revert", async function () {
            const badLen = "SHORT"; // 5자
            await expect(
                vesting.connect(owner).setReferralDiscount(badLen, 5n)
            ).to.be.revertedWith("ref len!=8");
        });

        it("setReferralDiscount: 100 초과는 'out of range' revert", async function () {
            await expect(
                vesting.connect(owner).setReferralDiscount(refCode, 101n)
            ).to.be.revertedWith("out of range");
        });

        it("할인 정상 적용: 10% 설정 후 estimatedTotalAmount에 315 USDT(=350*0.9) 반영", async function () {
            // 기준가(할인 전)
            const base1 = await estimated(1);
            expect(base1).to.equal(350n * ONE_USDT);

            // 10% 할인 설정
            await expect(vesting.connect(owner).setReferralDiscount(refCode, 10n))
                .to.emit(vesting, "ReferralDiscountSet");

            const p1 = await estimated(1);
            expect(p1).to.equal(315n * ONE_USDT);

            const p3 = await estimated(3);
            expect(p3).to.equal(3n * 315n * ONE_USDT);
        });

        it("할인 극단값: 0%면 가격 동일, 100%면 0", async function () {
            // 0% → 변화 없음
            await vesting.connect(owner).setReferralDiscount(refCode, 0n);
            const p0 = await estimated(2);
            expect(p0).to.equal(2n * 350n * ONE_USDT);

            // 100% → 0원
            await vesting.connect(owner).setReferralDiscount(refCode, 100n);
            const p100 = await estimated(5);
            expect(p100).to.equal(0n);

            // 다시 0%로 원복 → 기준가 복귀
            await vesting.connect(owner).setReferralDiscount(refCode, 0n);
            const pBack = await estimated(1);
            expect(pBack).to.equal(350n * ONE_USDT);
        });

        it("할인 설정 후 buyBox도 할인된 금액으로 진행(estimate와 일치)", async function () {
            await vesting.connect(owner).setReferralDiscount(refCode, 10n); // 10%

            const est = await estimated(4);
            const expected = 4n * 315n * ONE_USDT;
            expect(est).to.equal(expected);

            const p = { value: est, deadline: 0n, v: 0, r: ethers.ZeroHash, s: ethers.ZeroHash };
            await expect(vesting.connect(buyer).buyBox(4, refCode, p))
                .to.emit(vesting, "BoxesPurchased");
        });
    });

});
