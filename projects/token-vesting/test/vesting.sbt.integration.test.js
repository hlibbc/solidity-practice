// test/vesting.sbt.integration.test.js
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TokenVesting ↔ BadgeSBT integration", function () {
  const ONE_DAY = 86400n;
  const addr = (c) => (c?.target ?? c?.address);

  let owner, buyer, referrer, other;
  before(async () => {
    [owner, buyer, referrer, other] = await ethers.getSigners();
  });

  async function deployVestingAndSBT() {
    const blk = await ethers.provider.getBlock("latest");
    const now = BigInt(blk.timestamp);
    const start = now - (now % ONE_DAY); // 자정 정렬

    // 1) TokenVesting (forwarder = ZeroAddress, stableCoin = owner 주소로 대충 채움)
    const Vesting = await ethers.getContractFactory("TokenVesting");
    const vesting = await Vesting.deploy(ethers.ZeroAddress, owner.address, start);
    await vesting.waitForDeployment();

    // 2) BadgeSBT (admin = owner)
    const BadgeSBT = await ethers.getContractFactory("BadgeSBT");
    const sbt = await BadgeSBT.deploy("Badge", "BDG", owner.address);
    await sbt.waitForDeployment();

    // 3) Vesting ↔ SBT 연결 + admin 이관
    await vesting.connect(owner).setBadgeSBT(addr(sbt));
    await sbt.connect(owner).setAdmin(addr(vesting));

    // 4) 스케줄
    const poolEnd = start + ONE_DAY * 30n;
    const buyerTotal = ethers.parseUnits("1000000", 18);
    const refTotal = 0n;
    await vesting.initializeSchedule([poolEnd], [buyerTotal], [refTotal]);

    return { vesting, sbt, start };
  }

  function backfill(vesting, buyerAddr, start, dayOffset, boxCount) {
    const purchaseTs = start + ONE_DAY * BigInt(dayOffset);
    return vesting
      .connect(owner)
      .backfillPurchaseAt(buyerAddr, "", boxCount, purchaseTs, 0, false);
  }

  it("mints SBT on first purchase", async function () {
    const { vesting, sbt, start } = await deployVestingAndSBT();

    await backfill(vesting, buyer.address, start, 0, 100);

    const tokenId = await vesting.sbtIdOf(buyer.address);
    expect(tokenId).to.be.gt(0n);

    const realOwner = await sbt.ownerOf(tokenId);
    expect(realOwner).to.equal(buyer.address);

    const t1 = await sbt.currentTier(tokenId);
    expect(t1).to.equal(1n);

    const uri1 = await sbt.tokenURI(tokenId);
    expect(uri1).to.be.a("string").and.not.equal("");
  });

  it("upgrades tier as total box count crosses thresholds", async function () {
    const { vesting, sbt, start } = await deployVestingAndSBT();

    await backfill(vesting, buyer.address, start, 0, 100);
    const tokenId = await vesting.sbtIdOf(buyer.address);

    let tier = await sbt.currentTier(tokenId);
    expect(tier).to.equal(1n);
    const uri1 = await sbt.tokenURI(tokenId);
    expect(uri1).to.be.a("string").and.not.equal("");

    await backfill(vesting, buyer.address, start, 1, 4900);
    tier = await sbt.currentTier(tokenId);
    expect(tier).to.equal(2n);
    const uri2 = await sbt.tokenURI(tokenId);
    expect(uri2).to.not.equal(uri1);

    await backfill(vesting, buyer.address, start, 2, 10000);
    tier = await sbt.currentTier(tokenId);
    expect(tier).to.equal(3n);
    const uri3 = await sbt.tokenURI(tokenId);
    expect(uri3).to.not.equal(uri2);

    await backfill(vesting, buyer.address, start, 3, 10000);
    tier = await sbt.currentTier(tokenId);
    expect(tier).to.equal(4n);
    const uri4 = await sbt.tokenURI(tokenId);
    expect(uri4).to.not.equal(uri3);
  });

  it("reverts if SBT admin is NOT TokenVesting (no mint/upgrade)", async function () {
    const blk = await ethers.provider.getBlock("latest");
    const now = BigInt(blk.timestamp);
    const start = now - (now % ONE_DAY);

    // Vesting: forwarder = ZeroAddress (중요!)
    const Vesting = await ethers.getContractFactory("TokenVesting");
    const vesting = await Vesting.deploy(ethers.ZeroAddress, owner.address, start);
    await vesting.waitForDeployment();

    // SBT: admin=owner (이관하지 않음)
    const BadgeSBT = await ethers.getContractFactory("BadgeSBT");
    const sbt = await BadgeSBT.deploy("Badge", "BDG", owner.address);
    await sbt.waitForDeployment();

    // SBT 주소만 세팅 (admin 이관 X)
    await vesting.connect(owner).setBadgeSBT(addr(sbt));

    const poolEnd = start + ONE_DAY * 10n;
    await vesting.initializeSchedule([poolEnd], [ethers.parseUnits("1", 18)], [0]);

    await expect(backfill(vesting, buyer.address, start, 0, 123))
      .to.be.revertedWithCustomError(sbt, "NotAdmin");
  });
});
