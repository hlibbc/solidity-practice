// ============================
// file: test/TokenVesting.test.js
// ============================
const { expect } = require("chai");
const { ethers } = require("hardhat");

const SECONDS_PER_DAY = 86400;

describe("TokenVesting (JS tests, Usdt.sol present, dynamic years, referral string)", function () {
  async function deployFixture() {
    const [deployer, buyer, referrer, other] = await ethers.getSigners();

    // 1) Deploy USDT (ERC20Permit, 6 decimals)
    const USDT = await ethers.getContractFactory("Usdt");
    const usdt = await USDT.deploy();

    // 2) Deploy TokenVesting(start=now) and initialize schedule (epoch-based)
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const start = now;

    const TV = await ethers.getContractFactory("TokenVesting");
    const vesting = await TV.deploy(await usdt.getAddress(), start);

    // 기본 4개 term: 각 365일 (inclusive end = start - 1 + N*365d)
    const ends = [
      start - 1 + SECONDS_PER_DAY * 365,
      start - 1 + SECONDS_PER_DAY * 365 * 2,
      start - 1 + SECONDS_PER_DAY * 365 * 3,
      start - 1 + SECONDS_PER_DAY * 365 * 4,
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

    // 3) Fund buyer
    const BOX_PRICE_UNITS = await vesting.BOX_PRICE_UNITS(); // 350 * 10^6
    await usdt.transfer(await buyer.getAddress(), BOX_PRICE_UNITS * 10n);

    // 4) Seed a referral code for `referrer` on d=1 (코드만 생성, d=1 분모에는 영향 없음)
    const tsD1 = start + SECONDS_PER_DAY; // d=1
    await vesting.adminBackfillPurchaseAt(
      await other.getAddress(),        // dummy buyer
      await referrer.getAddress(),     // target referrer to assign code
      1,                               // minimal amount
      tsD1,                            // record on d=1
      BOX_PRICE_UNITS * 1n,
      false
    );
    const refCode = await vesting.myReferralCodeString(await referrer.getAddress());

    return { deployer, buyer, referrer, other, usdt, vesting, start, BOX_PRICE_UNITS, refCode };
  }

  async function increaseTime(seconds) {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine", []);
  }

  it("구매 → 자정 동기화 → claimable 조회(구매자/추천인) 기본 흐름", async () => {
    const { buyer, referrer, usdt, vesting, BOX_PRICE_UNITS, refCode, start } = await deployFixture();

    const boxCount = 2n;
    const cost = BOX_PRICE_UNITS * boxCount;

    await usdt.connect(buyer).approve(await vesting.getAddress(), cost);
    await expect(vesting.connect(buyer).buyBox(boxCount, refCode))
      .to.emit(vesting, "BoxesPurchased");

    // (A) 먼저 preview로 기대값 생성 (d=1까지 가정)
    const ts = start + SECONDS_PER_DAY * 2;
    const expectedBuyer = await vesting.previewBuyerClaimableAt(await buyer.getAddress(), ts);
    const expectedRef   = await vesting.previewReferrerClaimableAt(await referrer.getAddress(), ts);

    // (B) 실제로 2일 경과 + sync
    await increaseTime(SECONDS_PER_DAY * 2 + 3);
    await vesting.sync();

    // (C) 확정 결과가 preview와 동일해야 함
    expect(await vesting.getBuyerClaimableReward(await buyer.getAddress())).to.equal(expectedBuyer);
    expect(await vesting.getReferrerClaimableReward(await referrer.getAddress())).to.equal(expectedRef);
  });

  it("buyBoxWithPermit(EIP-2612) 경로 동작", async () => {
    const { buyer, usdt, vesting, BOX_PRICE_UNITS, refCode } = await deployFixture();

    const boxCount = 1n;
    const cost = BOX_PRICE_UNITS * boxCount;
    const deadline = (await ethers.provider.getBlock("latest")).timestamp + 3600;

    const name = await usdt.name();
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const nonce = await usdt.nonces(await buyer.getAddress());

    const domain = {
      name,
      version: "1",
      chainId: Number(chainId),
      verifyingContract: await usdt.getAddress(),
    };
    const types = {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    };
    const message = {
      owner: await buyer.getAddress(),
      spender: await vesting.getAddress(),
      value: cost,
      nonce,
      deadline,
    };

    const sig = await buyer.signTypedData(domain, types, message);
    const { v, r, s } = ethers.Signature.from(sig);

    await expect(
      vesting.connect(buyer).buyBoxWithPermit(boxCount, refCode, { value: cost, deadline, v, r, s })
    ).to.emit(vesting, "BoxesPurchased");
  });

  it("adminBackfillPurchaseAt: 시작일 이전 구매는 Day0 기록, Day1부터 분모 반영", async () => {
    const { deployer, buyer, referrer, vesting, BOX_PRICE_UNITS } = await deployFixture();

    const boxCount = 5n;
    const pastTs = (await ethers.provider.getBlock("latest")).timestamp - SECONDS_PER_DAY * 10;

    await expect(
      vesting.connect(deployer).adminBackfillPurchaseAt(
        await buyer.getAddress(),
        await referrer.getAddress(),
        boxCount,
        pastTs, // < start → d=0
        BOX_PRICE_UNITS * boxCount,
        true
      )
    ).to.not.be.reverted;

    // 아직 확정 전 → 0
    expect(await vesting.getBuyerClaimableReward(await buyer.getAddress())).to.equal(0);

    // 2일 경과 후 sync → d>=1 확정
    await increaseTime(SECONDS_PER_DAY * 2 + 1);
    await vesting.sync();

    const lastFinal = (await vesting.lastSyncedDay()) - 1n;
    const cumBuyer  = await vesting.cumRewardPerBox(lastFinal);
    const expectedBuyer = cumBuyer * boxCount;
    expect(await vesting.getBuyerClaimableReward(await buyer.getAddress())).to.equal(expectedBuyer);
  });

  it("preview* 미리보기: 확정 전/후의 금액이 서로 일치", async () => {
    const { buyer, referrer, usdt, vesting, BOX_PRICE_UNITS, start, refCode } = await deployFixture();

    const boxCount = 2n;
    const cost = BOX_PRICE_UNITS * boxCount;

    await usdt.connect(buyer).approve(await vesting.getAddress(), cost);
    await vesting.connect(buyer).buyBox(boxCount, refCode);

    // 아직 확정 전 → 0
    expect(await vesting.getBuyerClaimableReward(await buyer.getAddress())).to.equal(0);
    expect(await vesting.getReferrerClaimableReward(await referrer.getAddress())).to.equal(0);

    const ts = start + SECONDS_PER_DAY * 2;

    // 미리보기 금액(확정 전)
    const previewBuyer = await vesting.previewBuyerClaimableAt(await buyer.getAddress(), ts);
    const previewRef   = await vesting.previewReferrerClaimableAt(await referrer.getAddress(), ts);

    // 2일 후 sync → 실제 확정 금액
    await increaseTime(SECONDS_PER_DAY * 2 + 1);
    await vesting.sync();

    const afterBuyer = await vesting.getBuyerClaimableReward(await buyer.getAddress());
    const afterRef   = await vesting.getReferrerClaimableReward(await referrer.getAddress());

    expect(previewBuyer).to.equal(afterBuyer);
    expect(previewRef).to.equal(afterRef);
  });

  it("USDT 바이백 인출(추천인)", async () => {
    const { buyer, referrer, usdt, vesting, BOX_PRICE_UNITS, refCode } = await deployFixture();

    const boxCount = 3n;
    const cost = BOX_PRICE_UNITS * boxCount;

    await usdt.connect(buyer).approve(await vesting.getAddress(), cost);
    await vesting.connect(buyer).buyBox(boxCount, refCode);

    const before = await usdt.balanceOf(await referrer.getAddress());
    const buyback = await vesting.getBuybackBalance(await referrer.getAddress());

    await expect(vesting.connect(referrer).claimBuyback())
      .to.emit(vesting, "BuybackClaimed")
      .withArgs(await referrer.getAddress(), buyback);

    const after = await usdt.balanceOf(await referrer.getAddress());
    expect(after - before).to.equal(buyback);
    expect(await vesting.getBuybackBalance(await referrer.getAddress())).to.equal(0);
  });
});
