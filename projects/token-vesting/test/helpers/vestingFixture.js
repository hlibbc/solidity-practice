// test/helpers/vestingFixture.js
const { ethers } = require("hardhat");

const DAY = 86400n;
const ONE_USDT = 10n ** 6n;

async function deployFixture() {
  const [owner, buyer, referrer, other, ...rest] = await ethers.getSigners();

  const USDT = await ethers.getContractFactory("Usdt");
  const usdt = await USDT.deploy();

  const now = BigInt((await ethers.provider.getBlock("latest")).timestamp);
  const start = now;

  const TV = await ethers.getContractFactory("TokenVesting");
  const vesting = await TV.deploy(await usdt.getAddress(), start);

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

  // ✅ referrer에게 "SPLALABS" 코드를 직접 배정
  async function seedReferralFor(signer) {
    const code = "SPLALABS"; // 8자, A-Z/0-9 규칙 준수
    // overwrite=true: 기존 코드가 있어도 덮어씀 (테스트 반복 실행 대비)
    await vesting.setReferralCode(signer.address, code, true);
    return code; // 이후 테스트에서 buyBox 호출 시 문자열 그대로 사용
  }

  async function increaseTime(seconds) {
    await ethers.provider.send("evm_increaseTime", [Number(seconds)]);
    await ethers.provider.send("evm_mine", []);
  }

  return {
    owner, buyer, referrer, other,
    usdt, vesting, start, ends, buyerTotals, refTotals,
    DAY, ONE_USDT, seedReferralFor, increaseTime
  };
}

module.exports = { deployFixture };
