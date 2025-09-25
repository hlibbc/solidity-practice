// test/vesting.sbt.integration.test.js
/**
 * @fileoverview 
 *  TokenVesting과 BadgeSBT 컨트랙트 간의 통합 테스트
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");

// =============================================================================
// TokenVesting ↔ BadgeSBT integration
// =============================================================================
describe("TokenVesting ↔ BadgeSBT integration", function () {
    // =============================================================================
    // 상수/유틸
    // =============================================================================
    const ONE_DAY = 86400n;
    const addr = (c) => (c?.target ?? c?.address);

    let owner, buyer, referrer, other;

    before(async () => {
        [owner, buyer, referrer, other] = await ethers.getSigners();
    });

    // =============================================================================
    // 배포/연결 헬퍼
    // =============================================================================
    async function deployVestingAndSBT() {
        // 현재 블록 자정 정렬
        const blk = await ethers.provider.getBlock("latest");
        const now = BigInt(blk.timestamp);
        const start = now - (now % ONE_DAY);

        // 1) TokenVesting 배포 (forwarder=ZeroAddress, stableCoin=owner 주소 더미)
        const Vesting = await ethers.getContractFactory('TokenVesting');
        const vesting = await Vesting.deploy(ethers.ZeroAddress, owner.address, start);
        await vesting.waitForDeployment();

        // 2) BadgeSBT 배포 (admin=owner)
        const BadgeSBT = await ethers.getContractFactory('BadgeSBT');
        const sbt = await BadgeSBT.deploy("Badge", "BDG", owner.address);
        await sbt.waitForDeployment();
        let sbtAddr = await sbt.getAddress();

        const Resolver = await ethers.getContractFactory('BadgeSbtTierUriResolver', owner);
        const resolver = await Resolver.deploy(sbtAddr);
        await resolver.waitForDeployment();
        let resolverAddr = await resolver.getAddress();
        await sbt.setResolver(resolverAddr);

        // 3) 양방향 연결: vesting.setBadgeSBT() + sbt.setAdmin(vesting)
        await vesting.connect(owner).setBadgeSBT(addr(sbt));
        await sbt.connect(owner).setAdmin(addr(vesting));

        // 4) 스케줄 초기화 (30일간 100만)
        const poolEnd   = start + ONE_DAY * 30n;
        const buyerTotal = ethers.parseUnits("1000000", 18);
        const refTotal   = 0n;
        await vesting.initializeSchedule([poolEnd], [buyerTotal], [refTotal]);

        return { vesting, sbt, start };
    }

    /**
     * ✅ 컨트랙트 시그니처(BackfillPurchase[] items)에 맞춘 백필
     * BackfillPurchase {
     *   address buyer;
     *   string  refCodeStr;   // 빈 문자열이면 레퍼럴 없음
     *   uint256 boxCount;
     *   uint256 purchaseTs;
     *   uint256 paidUnits;    // 테스트 더미 값
     * }
     */
    function backfill(vesting, buyerAddr, start, dayOffset, boxCount) {
        const purchaseTs = start + ONE_DAY * BigInt(dayOffset);
        const item = {
            buyer:      buyerAddr,
            refCodeStr: "",        // 레퍼럴 없음
            boxCount:   boxCount,
            purchaseTs: purchaseTs,
            paidUnits:  0n,        // 테스트 더미
        };
        return vesting.connect(owner).backfillPurchaseBulkAt([item]);
    }

    // =============================================================================
    // SBT 자동 민팅
    // =============================================================================
    it("mints SBT on first purchase", async function () {
        const { vesting, sbt, start } = await deployVestingAndSBT();

        await backfill(vesting, buyer.address, start, 0, 100);

        const tokenId = await vesting.sbtIdOf(buyer.address);
        expect(tokenId).to.be.gt(0n);

        const realOwner = await sbt.ownerOf(tokenId);
        expect(realOwner).to.equal(buyer.address);

        const t1 = await sbt.currentTier(tokenId);
        expect(t1).to.be.gt(0n);

        const uri1 = await sbt.tokenURI(tokenId);
        expect(uri1).to.be.a("string").and.not.equal("");
    });

    // =============================================================================
    // 등급 업그레이드
    // =============================================================================
    it("upgrades tier as total box count crosses thresholds", async function () {
        const { vesting, sbt, start } = await deployVestingAndSBT();

        // enum 값 매핑 (BadgeSBT.Tier)
        const TIER = {
            None: 0n,
            Sprout: 1n,        // 1 ~ 4
            Cloud: 2n,         // 5 ~ 9
            Airplane: 3n,      // 10 ~ 19
            Rocket: 4n,        // 20 ~ 49
            SpaceStation: 5n,  // 50 ~ 99
            Moon: 6n,          // 100+
        };

        // 1) 총 1개 → Sprout
        await backfill(vesting, buyer.address, start, 0, 1n);
        const tokenId = await vesting.sbtIdOf(buyer.address);

        let tier = await sbt.currentTier(tokenId);
        expect(tier).to.equal(TIER.Sprout);
        let uriPrev = await sbt.tokenURI(tokenId);
        expect(uriPrev).to.be.a("string").and.not.equal("");

        // 2) +3개 (총 4개) → 여전히 Sprout
        await backfill(vesting, buyer.address, start, 1, 3n);
        tier = await sbt.currentTier(tokenId);
        expect(tier).to.equal(TIER.Sprout);
        let uriNow = await sbt.tokenURI(tokenId);
        expect(uriNow).to.equal(uriPrev); // 같은 티어면 URI 그대로
        uriPrev = uriNow;

        // 3) +1개 (총 5개) → Cloud
        await backfill(vesting, buyer.address, start, 2, 1n);
        tier = await sbt.currentTier(tokenId);
        expect(tier).to.equal(TIER.Cloud);
        uriNow = await sbt.tokenURI(tokenId);
        expect(uriNow).to.not.equal(uriPrev); // 티어 변경 → URI 변경
        uriPrev = uriNow;

        // 4) +5개 (총 10개) → Airplane
        await backfill(vesting, buyer.address, start, 3, 5n);
        tier = await sbt.currentTier(tokenId);
        expect(tier).to.equal(TIER.Airplane);
        uriNow = await sbt.tokenURI(tokenId);
        expect(uriNow).to.not.equal(uriPrev);
        uriPrev = uriNow;

        // 5) +10개 (총 20개) → Rocket
        await backfill(vesting, buyer.address, start, 4, 10n);
        tier = await sbt.currentTier(tokenId);
        expect(tier).to.equal(TIER.Rocket);
        uriNow = await sbt.tokenURI(tokenId);
        expect(uriNow).to.not.equal(uriPrev);
        uriPrev = uriNow;

        // 6) +30개 (총 50개) → SpaceStation
        await backfill(vesting, buyer.address, start, 5, 30n);
        tier = await sbt.currentTier(tokenId);
        expect(tier).to.equal(TIER.SpaceStation);
        uriNow = await sbt.tokenURI(tokenId);
        expect(uriNow).to.not.equal(uriPrev);
        uriPrev = uriNow;

        // 7) +50개 (총 100개) → Moon
        await backfill(vesting, buyer.address, start, 6, 50n);
        tier = await sbt.currentTier(tokenId);
        expect(tier).to.equal(TIER.Moon);
        uriNow = await sbt.tokenURI(tokenId);
        expect(uriNow).to.not.equal(uriPrev);
    });
;

    // =============================================================================
    // 관리자 권한 보안
    // =============================================================================
    it("reverts if SBT admin is NOT TokenVesting (no mint/upgrade)", async function () {
        const { vesting, sbt, start } = await deployVestingAndSBT();

        // admin을 vesting -> owner로 바꿔서 Vesting이 더 이상 SBT 관리자 아님
        await sbt.setAdmin(owner.address);

        await expect(backfill(vesting, buyer.address, start, 0, 123))
            .to.be.revertedWithCustomError(sbt, "NotAdmin");
    });

        // =============================================================================
    // Resolver 연동: 기본 URI 확인
    // =============================================================================
    it("resolver: returns default URIs by tier", async function () {
        const { vesting, sbt, start } = await deployVestingAndSBT();

        // Sprout: 1개
        await backfill(vesting, buyer.address, start, 0, 1n);
        const tokenId = await vesting.sbtIdOf(buyer.address);

        // 기본 URI 상수(Resolver constructor 초기 세팅값)
        const DEF = {
            Sprout:       "ipfs://.../sprout.json",
            Cloud:        "ipfs://.../cloud.json",
            Airplane:     "ipfs://.../airplane.json",
            Rocket:       "ipfs://.../rocket.json",
            SpaceStation: "ipfs://.../sstation.json",
            Moon:         "ipfs://.../moon.json",
        };

        // 1) Sprout
        let uri = await sbt.tokenURI(tokenId);
        expect(uri).to.equal(DEF.Sprout);

        // 2) Cloud (총 5개)
        await backfill(vesting, buyer.address, start, 1, 4n);
        uri = await sbt.tokenURI(tokenId);
        expect(uri).to.equal(DEF.Cloud);

        // 3) Airplane (총 10개)
        await backfill(vesting, buyer.address, start, 2, 5n);
        uri = await sbt.tokenURI(tokenId);
        expect(uri).to.equal(DEF.Airplane);

        // 4) Rocket (총 20개)
        await backfill(vesting, buyer.address, start, 3, 10n);
        uri = await sbt.tokenURI(tokenId);
        expect(uri).to.equal(DEF.Rocket);

        // 5) SpaceStation (총 50개)
        await backfill(vesting, buyer.address, start, 4, 30n);
        uri = await sbt.tokenURI(tokenId);
        expect(uri).to.equal(DEF.SpaceStation);

        // 6) Moon (총 100개)
        await backfill(vesting, buyer.address, start, 5, 50n);
        uri = await sbt.tokenURI(tokenId);
        expect(uri).to.equal(DEF.Moon);
    });

    // =============================================================================
    // Resolver 연동: setTierURIs로 URI 변경 후 반영 확인
    // =============================================================================
    it("resolver: reflects setTierURIs() updates in tokenURI()", async function () {
        const { vesting, sbt, start } = await deployVestingAndSBT();

        // Resolver 인스턴스 가져오기
        const resolverAddr = await sbt.resolver();
        const resolver = await ethers.getContractAt("BadgeSbtTierUriResolver", resolverAddr, owner);

        // 새 URI 맵핑 (Sprout..Moon)
        const tiers = [1, 2, 3, 4, 5, 6]; // IBadgeSBT.Tier enum 값 (None=0)
        const uris  = ["AAAAA", "BBBBB", "CCCCC", "DDDDD", "EEEEE", "FFFFF"];

        await resolver.setTierURIs(tiers, uris);

        // buyer의 SBT 생성 및 누적 구매량에 따른 tokenURI 검증
        // Sprout (1)
        await backfill(vesting, buyer.address, start, 0, 1n);
        const tokenId = await vesting.sbtIdOf(buyer.address);
        let got = await sbt.tokenURI(tokenId);
        expect(got).to.equal("AAAAA");

        // Cloud (총 5)
        await backfill(vesting, buyer.address, start, 1, 4n);
        got = await sbt.tokenURI(tokenId);
        expect(got).to.equal("BBBBB");

        // Airplane (총 10)
        await backfill(vesting, buyer.address, start, 2, 5n);
        got = await sbt.tokenURI(tokenId);
        expect(got).to.equal("CCCCC");

        // Rocket (총 20)
        await backfill(vesting, buyer.address, start, 3, 10n);
        got = await sbt.tokenURI(tokenId);
        expect(got).to.equal("DDDDD");

        // SpaceStation (총 50)
        await backfill(vesting, buyer.address, start, 4, 30n);
        got = await sbt.tokenURI(tokenId);
        expect(got).to.equal("EEEEE");

        // Moon (총 100)
        await backfill(vesting, buyer.address, start, 5, 50n);
        got = await sbt.tokenURI(tokenId);
        expect(got).to.equal("FFFFF");
    });

    // =============================================================================
    // 사용자 누적 구매량별 tokenURI 매핑 확인 (경계값 중심)
    // =============================================================================
    it("maps cumulative box counts to expected tier URIs (AAAAA..FFFFF)", async function () {
        const { vesting, sbt, start } = await deployVestingAndSBT();

        // Resolver 세팅
        const resolverAddr = await sbt.resolver();
        const resolver = await ethers.getContractAt("BadgeSbtTierUriResolver", resolverAddr, owner);
        await resolver.setTierURIs([1,2,3,4,5,6], ["AAAAA","BBBBB","CCCCC","DDDDD","EEEEE","FFFFF"]);

        // 1 → Sprout → AAAAA
        await backfill(vesting, buyer.address, start, 0, 1n);
        let tokenId = await vesting.sbtIdOf(buyer.address);
        let uri = await sbt.tokenURI(tokenId);
        expect(uri).to.equal("AAAAA");

        // 10 → Airplane → CCCCC (계약 기준: 10~19가 Airplane)
        await backfill(vesting, buyer.address, start, 1, 9n); // 총 10
        uri = await sbt.tokenURI(tokenId);
        expect(uri).to.equal("CCCCC");

        // 21 → Rocket → DDDDD (20~49)
        await backfill(vesting, buyer.address, start, 2, 11n); // 총 21
        uri = await sbt.tokenURI(tokenId);
        expect(uri).to.equal("DDDDD");

        // 55 → SpaceStation → EEEEE (50~99)
        await backfill(vesting, buyer.address, start, 3, 34n); // 총 55
        uri = await sbt.tokenURI(tokenId);
        expect(uri).to.equal("EEEEE");

        // 99 → SpaceStation → EEEEE (여전히 50~99)
        await backfill(vesting, buyer.address, start, 4, 44n); // 총 99
        uri = await sbt.tokenURI(tokenId);
        expect(uri).to.equal("EEEEE");

        // 100 → Moon → FFFFF (100+)
        await backfill(vesting, buyer.address, start, 5, 1n); // 총 100
        uri = await sbt.tokenURI(tokenId);
        expect(uri).to.equal("FFFFF");
    });


});
