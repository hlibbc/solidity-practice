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
const { ethers } = require("hardhat");
const { deployFixture } = require("./helpers/vestingFixture");

// =============================================================================
// 과거 구매 데이터 백필 기능 테스트 스위트
// =============================================================================

describe("vesting.backfill", function () {

    /**
     * @test start 이전 ts → d=0 기록, 분모는 d=0부터 반영
     * @description
     *  - 베스팅 시작일 이전의 구매 데이터를 백필하면 d=0으로 기록되는지 확인
     *  - d=0일의 rewardPerBox가 0보다 큰지(분모에 당일 누적 포함) 확인
     *  - cumBoxes[0]가 백필한 박스 수로 설정되는지 확인
     *
     * 테스트 시나리오:
     *  1) start - 10일 시점의 구매 5개를 백필(벌크 1건)
     *  2) 2일 경과 후 sync()
     *  3) rewardPerBox[0] > 0, cumBoxes[0] == 5
     */
    it("start 이전 ts → d=0 기록, 분모는 d=0부터 반영", async () => {
        const { vesting, buyer, start, ONE_USDT, DAY, increaseTime } = await deployFixture();
        const [deployer] = await ethers.getSigners();

        const pastTs = start - DAY * 10n; // < start
        const items = [{
            buyer: buyer.address,
            refCodeStr: "",          // 레퍼럴 없음
            boxCount: 5n,
            purchaseTs: pastTs,
            paidUnits: ONE_USDT * 5n
        }];

        // onlyOwner 호출
        await expect(
            vesting.connect(deployer).backfillPurchaseBulkAt(items)
        ).to.not.be.reverted;

        // 2일 경과 후 sync
        await increaseTime(DAY * 2n + 1n);
        await vesting.sync();

        // d=0 확정 검증
        const day0PerBox = await vesting.rewardPerBox(0n);
        expect(day0PerBox).to.be.gt(0n);

        expect(await vesting.cumBoxes(0n)).to.equal(5n);
    });

    /**
     * @test 확정된 날짜에 백필 시도 → revert('day finalized')
     * @description
     *  - 이미 sync()로 확정된 날짜(d=0)에 대해 백필 시도 시 revert 확인
     *  - "day finalized" 메시지 검증
     *
     * 시나리오:
     *  1) 하루 경과 후 sync()로 d=0 확정
     *  2) d=0 시점으로 백필 시도(벌크 1건) → revert
     */
    it("확정된 날짜에 백필 시도 → revert('day finalized')", async () => {
        const { vesting, buyer, start, ONE_USDT, DAY, increaseTime } = await deployFixture();
        const [deployer] = await ethers.getSigners();

        // 하루 경과 → d=0 확정
        await increaseTime(DAY + 1n);
        await vesting.sync(); // lastSyncedDay=1 (d=0 확정)

        const items = [{
            buyer: buyer.address,
            refCodeStr: "",
            boxCount: 1n,
            purchaseTs: start,   // d=0
            paidUnits: ONE_USDT
        }];

        await expect(
            vesting.connect(deployer).backfillPurchaseBulkAt(items)
        ).to.be.revertedWith("day finalized");
    });
});
