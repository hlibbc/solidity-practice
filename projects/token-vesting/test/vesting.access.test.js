// test/vesting.access.test.js
/**
 * @fileoverview
 *  TokenVesting 컨트랙트의 접근 제어(onlyOwner) 기능 테스트
 * @description
 *  - 관리자 전용 함수들의 onlyOwner 보호 기능을 각 함수별로 개별 it에서 검증
 *  - 일반 사용자가 관리자 함수 호출 시도 시 OwnableUnauthorizedAccount 에러 및 호출자 주소 확인
 *
 * 대상 함수(최신):
 *   - initializeSchedule
 *   - setVestingToken
 *   - setBadgeSBT
 *   - setRecipient
 *   - setReferralCodesBulk
 *   - backfillPurchaseBulkAt
 *   - backfillSendBoxBulkAt
 *   - syncLimitDay
 */

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployFixture } = require("./helpers/vestingFixture");

describe("vesting.access (onlyOwner guard)", function () {
    it("initializeSchedule: onlyOwner", async () => {
        const { vesting, buyer, start, DAY } = await deployFixture();

        // initializeSchedule(uint256[] _poolEnds, uint256[] _buyerTotals, uint256[] _refTotals)
        const ends = [
            start - 1n + DAY * 10n,
            start - 1n + DAY * 20n,
        ];
        const buyerTotals = [1n, 1n];
        const refTotals   = [1n, 1n];

        await expect(
            vesting.connect(buyer).initializeSchedule(ends, buyerTotals, refTotals)
        ).to.be.revertedWithCustomError(vesting, "OwnableUnauthorizedAccount")
         .withArgs(buyer.address);
    });

    it("setVestingToken: onlyOwner", async () => {
        const { vesting, buyer, stableCoin } = await deployFixture();
        await expect(
            vesting.connect(buyer).setVestingToken(await stableCoin.getAddress())
        ).to.be.revertedWithCustomError(vesting, "OwnableUnauthorizedAccount")
         .withArgs(buyer.address);
    });

    it("setBadgeSBT: onlyOwner", async () => {
        const { vesting, buyer, stableCoin } = await deployFixture();
        // 임의의 non-zero 주소(타입 불문). onlyOwner가 먼저 체크되므로 유효성만 충족하면 됨.
        const dummySbtAddr = await stableCoin.getAddress();
        await expect(
            vesting.connect(buyer).setBadgeSBT(dummySbtAddr)
        ).to.be.revertedWithCustomError(vesting, "OwnableUnauthorizedAccount")
         .withArgs(buyer.address);
    });

    it("setRecipient: onlyOwner", async () => {
        const { vesting, buyer } = await deployFixture();
        const [, someone] = await ethers.getSigners();
        await expect(
            vesting.connect(buyer).setRecipient(await someone.getAddress())
        ).to.be.revertedWithCustomError(vesting, "OwnableUnauthorizedAccount")
         .withArgs(buyer.address);
    });

    it("setReferralCodesBulk: onlyOwner", async () => {
        const { vesting, buyer } = await deployFixture();

        const users = [buyer.address];
        const codes = ["ABCDEFGH"]; // 8자, A-Z/0-9
        const overwrite = true;

        await expect(
            vesting.connect(buyer).setReferralCodesBulk(users, codes, overwrite)
        ).to.be.revertedWithCustomError(vesting, "OwnableUnauthorizedAccount")
         .withArgs(buyer.address);
    });

    it("backfillPurchaseBulkAt: onlyOwner", async () => {
        const { vesting, buyer, start } = await deployFixture();

        // BackfillPurchase { buyer, refCodeStr, boxCount, purchaseTs, paidUnits }
        const items = [{
            buyer: buyer.address,
            refCodeStr: "",     // 레퍼럴 없음
            boxCount: 1n,
            purchaseTs: start,
            paidUnits: 0n,
        }];

        await expect(
            vesting.connect(buyer).backfillPurchaseBulkAt(items)
        ).to.be.revertedWithCustomError(vesting, "OwnableUnauthorizedAccount")
         .withArgs(buyer.address);
    });

    it("backfillSendBoxBulkAt: onlyOwner", async () => {
        const { vesting, buyer, start } = await deployFixture();
        const [, other] = await ethers.getSigners();

        // BackfillSendBox { from, to, boxCount, transferTs }
        const items = [{
            from: buyer.address,
            to: await other.getAddress(),
            boxCount: 1n,
            transferTs: start,
        }];

        await expect(
            vesting.connect(buyer).backfillSendBoxBulkAt(items)
        ).to.be.revertedWithCustomError(vesting, "OwnableUnauthorizedAccount")
         .withArgs(buyer.address);
    });

    it("syncLimitDay: onlyOwner", async () => {
        const { vesting, buyer } = await deployFixture();

        await expect(
            vesting.connect(buyer).syncLimitDay(1)
        ).to.be.revertedWithCustomError(vesting, "OwnableUnauthorizedAccount")
         .withArgs(buyer.address);
    });
});

// -----------------------------------------------------------------------------
// 소유권 이전 이후 접근 제어 동작 확인
//  - before에서 기존 owner가 배포한 컨트랙트의 소유권을 newOwner로 이전
//  - 각 it에서 oldOwner는 실패, newOwner는 성공 동작을 검증
//  - initializeSchedule은 사전에 실행하지 않고, 필요한 it 내부에서 newOwner로 호출
// -----------------------------------------------------------------------------
describe("vesting.access after ownership transfer", function () {
    let vesting, stableCoin, sbt, start, DAY;
    let oldOwner, newOwner, buyer, other;

    before(async () => {
        const fix = await deployFixture();
        ({ vesting, stableCoin, sbt, start, DAY } = fix);
        [oldOwner, newOwner, buyer, other] = await ethers.getSigners();
        // 소유권을 newOwner로 이전
        await vesting.connect(oldOwner).transferOwnership(await newOwner.getAddress());
    });

    it("initializeSchedule: oldOwner 실패, newOwner 성공", async () => {
        // 별도의 배포(스케줄 미초기화 상태)로 검증
        const [ownerSigner, newOwnerLocal, buyerLocal, otherLocal] = await ethers.getSigners();
        const Fwd = await ethers.getContractFactory('WhitelistForwarder', ownerSigner);
        const forwarder2 = await Fwd.deploy();
        await forwarder2.waitForDeployment();

        const StableCoin = await ethers.getContractFactory('StableCoin', ownerSigner);
        const stable2 = await StableCoin.deploy();
        await stable2.waitForDeployment();

        const now2 = BigInt((await ethers.provider.getBlock('latest')).timestamp);
        const TV = await ethers.getContractFactory('TokenVesting', ownerSigner);
        const vest2 = await TV.deploy(
            await forwarder2.getAddress(),
            await stable2.getAddress(),
            now2
        );
        await vest2.waitForDeployment();
        await vest2.connect(ownerSigner).transferOwnership(await newOwnerLocal.getAddress());

        const ends = [now2 - 1n + DAY * 10n, now2 - 1n + DAY * 20n];
        const buyerTotals = [1n, 1n];
        const refTotals = [1n, 1n];

        await expect(
            vest2.connect(ownerSigner).initializeSchedule(ends, buyerTotals, refTotals)
        ).to.be.revertedWithCustomError(vest2, "OwnableUnauthorizedAccount").withArgs(ownerSigner.address);

        await expect(
            vest2.connect(newOwnerLocal).initializeSchedule(ends, buyerTotals, refTotals)
        ).to.not.be.reverted;
    });

    it("setVestingToken: oldOwner 실패, newOwner 성공", async () => {
        await expect(
            vesting.connect(oldOwner).setVestingToken(await stableCoin.getAddress())
        ).to.be.revertedWithCustomError(vesting, "OwnableUnauthorizedAccount").withArgs(oldOwner.address);

        await expect(
            vesting.connect(newOwner).setVestingToken(await stableCoin.getAddress())
        ).to.not.be.reverted;
    });

    it("setBadgeSBT: oldOwner 실패, newOwner 성공", async () => {
        await expect(
            vesting.connect(oldOwner).setBadgeSBT(await stableCoin.getAddress())
        ).to.be.revertedWithCustomError(vesting, "OwnableUnauthorizedAccount").withArgs(oldOwner.address);

        await expect(
            // 유효한 SBT 컨트랙트 주소로 설정 (fixture에서 배포된 sbt)
            vesting.connect(newOwner).setBadgeSBT(await sbt.getAddress())
        ).to.not.be.reverted;
    });

    it("setRecipient: oldOwner 실패, newOwner 성공", async () => {
        await expect(
            vesting.connect(oldOwner).setRecipient(await other.getAddress())
        ).to.be.revertedWithCustomError(vesting, "OwnableUnauthorizedAccount").withArgs(oldOwner.address);

        await expect(
            vesting.connect(newOwner).setRecipient(await other.getAddress())
        ).to.not.be.reverted;
    });

    it("setReferralCodesBulk: oldOwner 실패, newOwner 성공", async () => {
        const users = [buyer.address];
        const codes = ["ABCDEFGH"]; // 8자리 코드
        const overwrite = true;

        await expect(
            vesting.connect(oldOwner).setReferralCodesBulk(users, codes, overwrite)
        ).to.be.revertedWithCustomError(vesting, "OwnableUnauthorizedAccount").withArgs(oldOwner.address);

        await expect(
            vesting.connect(newOwner).setReferralCodesBulk(users, codes, overwrite)
        ).to.not.be.reverted;
    });

    it("backfillPurchaseBulkAt: oldOwner 실패, newOwner 성공", async () => {
        const items = [{
            buyer: buyer.address,
            refCodeStr: "",
            boxCount: 1n,
            purchaseTs: start,
            paidUnits: 0n,
        }];

        await expect(
            vesting.connect(oldOwner).backfillPurchaseBulkAt(items)
        ).to.be.revertedWithCustomError(vesting, "OwnableUnauthorizedAccount").withArgs(oldOwner.address);

        const tx = await vesting.connect(newOwner).backfillPurchaseBulkAt(items);
        await tx.wait();
    });

    it("backfillSendBoxBulkAt: oldOwner 실패, newOwner 성공(선행 구매 후 전송)", async () => {
        const purchase = [{
            buyer: buyer.address,
            refCodeStr: "",
            boxCount: 1n,
            purchaseTs: start,
            paidUnits: 0n,
        }];
        await vesting.connect(newOwner).backfillPurchaseBulkAt(purchase);

        const items = [{
            from: buyer.address,
            to: await other.getAddress(),
            boxCount: 1n,
            transferTs: start,
        }];

        await expect(
            vesting.connect(oldOwner).backfillSendBoxBulkAt(items)
        ).to.be.revertedWithCustomError(vesting, "OwnableUnauthorizedAccount").withArgs(oldOwner.address);

        const tx = await vesting.connect(newOwner).backfillSendBoxBulkAt(items);
        await tx.wait();
    });

    it("syncLimitDay: oldOwner 실패, newOwner 성공", async () => {
        // 하루 경과시켜 동기화 대상 생성
        await ethers.provider.send("evm_increaseTime", [Number(DAY)]);
        await ethers.provider.send("evm_mine", []);
        await expect(
            vesting.connect(oldOwner).syncLimitDay(1)
        ).to.be.revertedWithCustomError(vesting, "OwnableUnauthorizedAccount").withArgs(oldOwner.address);

        await expect(
            vesting.connect(newOwner).syncLimitDay(1)
        ).to.not.be.reverted;
    });
});
