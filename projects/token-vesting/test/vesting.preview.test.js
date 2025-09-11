// test/vesting.preview.test.js
/**
 * @fileoverview 
 *  TokenVesting 컨트랙트의 보상 미리보기(preview) 기능 테스트
 * @description
 *  - 특정 시점에서의 클레임 가능한 보상 미리보기 기능 검증
 *  - sync 전후 동일한 시점 기준 미리보기 값의 일치성 확인
 *  - 구매자 풀과 추천인 풀의 미리보기 함수 정확성 검증
 * 
 * @author hlibbc
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployFixture } = require("./helpers/vestingFixture");

// =============================================================================
// 유틸리티
// =============================================================================
function makePermit(value, deadline = 0n, v = 0, r = ethers.ZeroHash, s = ethers.ZeroHash) {
    return { value, deadline, v, r, s };
}

describe("vesting.preview", function () {
    it("previewBuyer/Referrer: sync 후에도 같은 ts 기준 값이 일치", async () => {
        // === 테스트 환경 설정 ===
        const {
            owner,                   // ⭐ recipient 세팅/잔액 이동용
            buyer, referrer, vesting, stableCoin,
            start, DAY, seedReferralFor, increaseTime
        } = await deployFixture();

        // 최초 하루 경과 → d=0 확정
        await increaseTime(DAY + 1n);
        await vesting.sync();

        // ⭐ recipient 미설정이면 buyBox에서 revert → 미리 세팅
        await vesting.connect(owner).setRecipient(owner.address);

        // 레퍼럴 코드
        const refCode = await seedReferralFor(referrer);

        // buyer가 미리 approve
        await stableCoin.connect(buyer).approve(await vesting.getAddress(), ethers.MaxUint256);

        // 박스 구매 2개
        const boxCount = 2n;
        const estimated = await vesting.estimatedTotalAmount(boxCount, refCode);
        expect(estimated).to.be.gt(0n);

        // ⭐ buyer 잔액 확보(테스트 토큰이 mint 지원하면 mint, 아니면 owner→buyer 전송)
        if (typeof stableCoin.mint === "function") {
            await stableCoin.mint(buyer.address, estimated);
        } else {
            await stableCoin.connect(owner).transfer(buyer.address, estimated);
        }

        // deadline=0 → approve 경로, value는 내부 비교값과 동일해야 함
        const pSkip = makePermit(estimated, 0n);

        await expect(vesting.connect(buyer).buyBox(boxCount, refCode, pSkip))
            .to.emit(vesting, "BoxesPurchased");

        // === 미리보기(ts: start + 2일) — sync 전 ===
        const ts = start + DAY * 2n;
        const prevBuyer = await vesting.previewBuyerClaimableAt(buyer.address, ts);
        const prevRef   = await vesting.previewReferrerClaimableAt(referrer.address, ts);

        // 실제로 해당 시점까지 시간 진행 + sync
        const now = BigInt((await ethers.provider.getBlock("latest")).timestamp);
        const delta = ts > now ? (ts - now + 1n) : 1n; // 음수 방지 여유 1초
        await increaseTime(delta);
        await vesting.sync();

        // === 같은 ts로 다시 미리보기 — sync 후 ===
        const afterBuyer = await vesting.previewBuyerClaimableAt(buyer.address, ts);
        const afterRef   = await vesting.previewReferrerClaimableAt(referrer.address, ts);

        expect(afterBuyer).to.equal(prevBuyer);
        expect(afterRef).to.equal(prevRef);
    });
});
