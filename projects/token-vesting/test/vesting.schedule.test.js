// test/vesting.schedule.test.js
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployFixture } = require("./helpers/vestingFixture");

describe("vesting.schedule", function () {

  it("initializeSchedule: 정상 초기화", async () => {
    const { vesting, ends, buyerTotals, refTotals } = await deployFixture();
    expect(await vesting.scheduleInitialized()).to.equal(true);
    // 간단 검증: poolEndTimes 길이
    expect((await vesting.poolEndTimes(0)) > 0n).to.equal(true);
    expect(await vesting.nextSyncTs()).to.not.equal(0n);
  });

  it("initializeSchedule: 재호출 불가", async () => {
    const { vesting, ends, buyerTotals, refTotals } = await deployFixture();
    await expect(
      vesting.initializeSchedule(ends, buyerTotals, refTotals)
    ).to.be.revertedWith("schedule inited");
  });

  it("initializeSchedule: 실패 케이스(길이/증가/시작전)", async () => {
    const [owner] = await ethers.getSigners();
    const StableCoin = await ethers.getContractFactory("StableCoin");
    const stableCoin = await StableCoin.deploy();

    // ── TokenVesting 배포 (새 생성자: forwarder, stableCoin, start)
    const now = BigInt((await ethers.provider.getBlock("latest")).timestamp);
    const TV = await ethers.getContractFactory("TokenVesting");
    const vesting = await TV.deploy(
      ethers.ZeroAddress,
      await stableCoin.getAddress(),
      now
    );

    // ── BadgeSBT 배포: admin = vesting (mint/upgrade가 onlyAdmin이므로)
    const BadgeSBT = await ethers.getContractFactory("BadgeSBT");
    const sbt = await BadgeSBT.deploy("Badge", "BDG", await vesting.getAddress());

    // ── TokenVesting에 SBT 주소 연결
    await vesting.setBadgeSBT(await sbt.getAddress());

    const ends_ok = [ now - 1n + 86400n, now - 1n + 86400n * 2n ];
    const ends_bad_len = [ now - 1n + 86400n ];
    const buyerTotals = [1n, 2n];
    const refTotals   = [1n, 2n];

    await expect(vesting.initializeSchedule(ends_bad_len, buyerTotals, refTotals))
      .to.be.revertedWith("len mismatch");

    const ends_bad_increasing = [ now - 1n + 86400n * 2n, now - 1n + 86400n ];
    await expect(vesting.initializeSchedule(ends_bad_increasing, buyerTotals, refTotals))
      .to.be.revertedWith("not increasing");

    const ends_bad_start = [ now - 1000n, now - 1n + 86400n ]; // end<=start
    await expect(vesting.initializeSchedule(ends_bad_start, buyerTotals, refTotals))
      .to.be.revertedWith("end<=start");

    // 정상
    await expect(vesting.initializeSchedule(ends_ok, buyerTotals, refTotals)).to.not.be.reverted;
  });
});
