// test/helpers/vestingFixture.js
const { ethers } = require("hardhat");

const DAY = 86400n;
const ONE_USDT = 10n ** 6n;

async function deployFixture() {
  const [owner, buyer, referrer, other, ...rest] = await ethers.getSigners();

  // ── StableCoin 배포
  const StableCoin = await ethers.getContractFactory("StableCoin");
  const stableCoin = await StableCoin.deploy();

  // ── 시작 시각
  const now = BigInt((await ethers.provider.getBlock("latest")).timestamp);
  const start = now;

  // ── TokenVesting 배포 (새 생성자: forwarder, stableCoin, start)
  const TV = await ethers.getContractFactory("TokenVesting");
  const vesting = await TV.deploy(
    ethers.ZeroAddress,
    await stableCoin.getAddress(),
    start
  );

  // ── BadgeSBT 배포: admin = vesting (mint/upgrade가 onlyAdmin이므로)
  const BadgeSBT = await ethers.getContractFactory("BadgeSBT");
  const sbt = await BadgeSBT.deploy("Badge", "BDG", await vesting.getAddress());

  // ── TokenVesting에 SBT 주소 연결
  await vesting.setBadgeSBT(await sbt.getAddress());

  // ── 스케줄 초기화
  const ends = [
    start - 1n + DAY * 365n,
    start - 1n + DAY * 365n * 2n,
    start - 1n + DAY * 365n * 3n,
    start - 1n + DAY * 365n * 4n,
  ];
  const buyerTotals = [
    ethers.parseEther("170000000"),
    ethers.parseEther("87500000"),
    ethers.parseEther("52500000"),
    ethers.parseEther("40000000"),
  ];
  const refTotals = [
    ethers.parseEther("15000000"),
    ethers.parseEther("15000000"),
    0n,
    0n,
  ];
  await vesting.initializeSchedule(ends, buyerTotals, refTotals);

  // ✅ referrer에게 "SPLALABS" 코드 직접 배정
  async function seedReferralFor(signer) {
    const code = "SPLALABS";
    await vesting.setReferralCode(signer.address, code, true);
    return code;
  }

  async function increaseTime(seconds) {
    await ethers.provider.send("evm_increaseTime", [Number(seconds)]);
    await ethers.provider.send("evm_mine", []);
  }

  return {
    owner, buyer, referrer, other,
    stableCoin, sbt, vesting, start, ends, buyerTotals, refTotals,
    DAY, ONE_USDT, seedReferralFor, increaseTime
  };
}

module.exports = { deployFixture };
