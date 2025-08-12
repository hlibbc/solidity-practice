// ============================
// file: test/TokenVesting.test.js
// ============================
const { expect } = require("chai");
const { ethers } = require("hardhat");

const SECONDS_PER_DAY = 86400n; // bigint 일관성
const ONE_USDT = 10n ** 6n;     // 6 decimals

describe("TokenVesting (JS tests, Usdt.sol present, dynamic years, referral string)", function () {
  async function deployFixture() {
    const [deployer, buyer, referrer, other] = await ethers.getSigners();

    // 1) Deploy USDT (ERC20Permit, 6 decimals)
    const USDT = await ethers.getContractFactory("Usdt");
    const usdt = await USDT.deploy();

    // 2) Deploy TokenVesting(start=now) and initialize schedule (epoch-based)
    const now = BigInt((await ethers.provider.getBlock("latest")).timestamp);
    const start = now;

    const TV = await ethers.getContractFactory("TokenVesting");
    const vesting = await TV.deploy(await usdt.getAddress(), start);

    // 기본 4개 term: 각 365일 (inclusive end = start - 1 + N*365d)
    const ends = [
      start - 1n + SECONDS_PER_DAY * 365n,
      start - 1n + SECONDS_PER_DAY * 365n * 2n,
      start - 1n + SECONDS_PER_DAY * 365n * 3n,
      start - 1n + SECONDS_PER_DAY * 365n * 4n,
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

    // 3) Seed a referral code for `referrer` on d=1 (코드만 생성, d=1 분모에는 영향 없음)
    const tsD1 = start + SECONDS_PER_DAY; // d=1
    await vesting.adminBackfillPurchaseAt(
      await other.getAddress(),        // dummy buyer
      await referrer.getAddress(),     // target referrer to assign code
      1n,                              // minimal amount
      tsD1,                            // record on d=1
      ONE_USDT * 1n,
      false
    );
    const refCode = await vesting.myReferralCodeString(await referrer.getAddress());

    return { deployer, buyer, referrer, other, usdt, vesting, start, refCode };
  }

  async function increaseTime(seconds) {
    // seconds: number | bigint 둘 다 허용 → number로 변환
    const sec = Number(seconds);
    await ethers.provider.send("evm_increaseTime", [sec]);
    await ethers.provider.send("evm_mine", []);
  }

  it("구매 → 자정 동기화 → claimable 조회(구매자/추천인) 기본 흐름", async () => {
    const { buyer, referrer, vesting, refCode, start } = await deployFixture();

    const boxCount = 2n;

    // permit 스킵용 제로 파라미터
    const pSkip = { value: 0n, deadline: 0n, v: 0, r: ethers.ZeroHash, s: ethers.ZeroHash };

    await expect(vesting.connect(buyer).buyBox(boxCount, refCode, pSkip))
      .to.emit(vesting, "BoxesPurchased");

    // (A) 먼저 preview로 기대값 생성 (d=1까지 가정)
    const ts = start + SECONDS_PER_DAY * 2n;
    const expectedBuyer = await vesting.previewBuyerClaimableAt(await buyer.getAddress(), ts);
    const expectedRef   = await vesting.previewReferrerClaimableAt(await referrer.getAddress(), ts);

    // (B) 실제로 2일 경과 + sync
    await increaseTime(SECONDS_PER_DAY * 2n + 3n);
    await vesting.sync();

    // (C) 확정 결과가 preview와 동일해야 함
    expect(await vesting.getBuyerClaimableReward(await buyer.getAddress())).to.equal(expectedBuyer);
    expect(await vesting.getReferrerClaimableReward(await referrer.getAddress())).to.equal(expectedRef);
  });

  it("buyBox(EIP-2612 permit 경로) 동작", async () => {
    const { buyer, usdt, vesting, refCode } = await deployFixture();

    const boxCount = 1n;
    const cost = ONE_USDT * boxCount; // 실제 전송은 0이지만, permit 테스트용으로 non-zero도 OK
    const deadline = BigInt((await ethers.provider.getBlock("latest")).timestamp) + 3600n;

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
      deadline: Number(deadline),
    };

    const sig = await buyer.signTypedData(domain, types, message);
    const { v, r, s } = ethers.Signature.from(sig);

    await expect(
      vesting.connect(buyer).buyBox(boxCount, refCode, { value: cost, deadline, v, r, s })
    ).to.emit(vesting, "BoxesPurchased");
  });

  it("adminBackfillPurchaseAt: 시작일 이전 구매는 Day0 기록, Day1부터 분모 반영", async () => {
    const { deployer, buyer, referrer, vesting, start } = await deployFixture();

    const boxCount = 5n;
    const pastTs = BigInt((await ethers.provider.getBlock("latest")).timestamp) - SECONDS_PER_DAY * 10n;

    await expect(
      vesting.connect(deployer).adminBackfillPurchaseAt(
        await buyer.getAddress(),
        await referrer.getAddress(),
        boxCount,
        pastTs, // < start → d=0
        ONE_USDT * boxCount,
        true
      )
    ).to.not.be.reverted;

    // 아직 확정 전 → 0
    expect(await vesting.getBuyerClaimableReward(await buyer.getAddress())).to.equal(0);

    // 2일 경과 후 sync → d>=1 확정
    await increaseTime(SECONDS_PER_DAY * 2n + 1n);
    await vesting.sync();

    const lastSynced = await vesting.lastSyncedDay(); // bigint
    const lastFinal = lastSynced - 1n;
    const cumBuyer  = await vesting.cumRewardPerBox(lastFinal);
    const expectedBuyer = cumBuyer * boxCount;
    expect(await vesting.getBuyerClaimableReward(await buyer.getAddress())).to.equal(expectedBuyer);
  });

  it("preview* 미리보기: 확정 전/후의 금액이 서로 일치", async () => {
    const { buyer, referrer, vesting, start, refCode } = await deployFixture();

    const boxCount = 2n;
    const pSkip = { value: 0n, deadline: 0n, v: 0, r: ethers.ZeroHash, s: ethers.ZeroHash };

    await vesting.connect(buyer).buyBox(boxCount, refCode, pSkip);

    // 아직 확정 전 → 0
    expect(await vesting.getBuyerClaimableReward(await buyer.getAddress())).to.equal(0);
    expect(await vesting.getReferrerClaimableReward(await referrer.getAddress())).to.equal(0);

    const ts = start + SECONDS_PER_DAY * 2n;

    // 미리보기 금액(확정 전)
    const previewBuyer = await vesting.previewBuyerClaimableAt(await buyer.getAddress(), ts);
    const previewRef   = await vesting.previewReferrerClaimableAt(await referrer.getAddress(), ts);

    // 2일 후 sync → 실제 확정 금액
    await increaseTime(SECONDS_PER_DAY * 2n + 1n);
    await vesting.sync();

    const afterBuyer = await vesting.getBuyerClaimableReward(await buyer.getAddress());
    const afterRef   = await vesting.getReferrerClaimableReward(await referrer.getAddress());

    expect(previewBuyer).to.equal(afterBuyer);
    expect(previewRef).to.equal(afterRef);
  });

  it("USDT 바이백 인출(추천인)", async () => {
    const { deployer, buyer, referrer, usdt, vesting, start } = await deployFixture();

    // 과거 구매 1건을 백필 + 바이백 적립
    const paid = ONE_USDT * 123n;
    await vesting.connect(deployer).adminBackfillPurchaseAt(
      await buyer.getAddress(),
      await referrer.getAddress(),
      1n,
      start + SECONDS_PER_DAY, // d=1
      paid,
      true // ✅ buyback 적립
    );

    const expectedBuyback = (paid * 10n) / 100n;

    // 컨트랙트가 바이백 지급할 USDT 보유하도록 선입금
    await usdt.transfer(await vesting.getAddress(), expectedBuyback);

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
