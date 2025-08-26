// test/vesting.pricing.test.js
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployFixture } = require("./helpers/vestingFixture");

const ONE_USDT = 10n ** 6n;
const DAY = 86400n;

function makePermit(value) {
  // permit 미사용: deadline=0 → buyBox 내부에서 permit 경로 스킵
  return {
    value,
    deadline: 0,
    v: 0,
    r: ethers.ZeroHash,
    s: ethers.ZeroHash,
  };
}

describe("TokenVesting - pricing & buyBox amount check (using vestingFixture)", function () {
  let owner, buyer, referrer, other;
  let stableCoin, vesting, start, increaseTime, seedReferralFor;
  let refCode;

  beforeEach(async () => {
    ({
      owner, buyer, referrer, other,
      stableCoin, vesting, start,
      increaseTime, seedReferralFor
    } = await deployFixture());

    // 레퍼럴 코드 준비 (fixture가 SPLALABS로 세팅해줌)
    refCode = await seedReferralFor(referrer);

    // (옵션) buyer에게 토큰 조금 전송 & approve
    // StableCoin 구현에 따라 필요 없을 수 있으나, 안전하게 승인 걸어둡니다.
    await stableCoin.connect(owner).transfer(buyer.address, 1_000_000n * ONE_USDT);
    await stableCoin.connect(buyer).approve(await vesting.getAddress(), ethers.MaxUint256);
  });

  async function estimated(qty, code = refCode) {
    return await vesting.estimatedTotalAmount(qty, code);
  }

  async function buyBox(from, qty, code = refCode) {
    const est = await estimated(qty, code);
    const p = makePermit(est);
    await expect(vesting.connect(from).buyBox(qty, code, p))
      .to.emit(vesting, "BoxesPurchased");
    return est;
  }

  async function backfill(count, atTs, code = refCode, creditBuyback = false) {
    // refCodeStr 비우면 레퍼럴 없는 구매가 되어 today/referralsAddedPerDay에 안 잡힙니다.
    await vesting.connect(owner).backfillPurchaseAt(
      other.address, code, count, atTs, 1_000n, creditBuyback
    );
  }

  async function syncAll() {
    // fixture의 start=현재 블록이므로, 하루가 지나야 sync가 진행됩니다.
    await vesting.sync();
  }

  it("첫 박스 가격은 350 USDT", async () => {
    const price = await estimated(1);
    expect(price).to.equal(350n * ONE_USDT);
  });

  it("초기 티어에서 대량구매는 단순합: 200개 = 200 * 350", async () => {
    const price = await estimated(200);
    expect(price).to.equal(200n * 350n * ONE_USDT);
  });

  it("티어 경계(3199→3200) 전환: 3199개 판매 후 다음 1개는 375 USDT", async () => {
    // start 시각(day=0)에 3199개 백필
    await backfill(3199n, start);

    // 하루 경과시켜 sync 가능하게 하고 확정
    await increaseTime(DAY + 1n);
    await syncAll();

    // 이제 index=3200 → 375 USDT
    const price = await estimated(1);
    expect(price).to.equal(375n * ONE_USDT);

    // buyBox도 같은 값이어야 통과
    const est = await buyBox(buyer, 1);
    expect(est).to.equal(375n * ONE_USDT);
  });

  it("단일 구매로 경계를 넘는 경우: 3190개 판매 상태에서 15개 구매 → 9*350 + 6*375", async () => {
    await backfill(3190n, start);
    await increaseTime(DAY + 1n);
    await syncAll();

    const price = await estimated(15);
    const expected = (9n * 350n + 6n * 375n) * ONE_USDT;
    expect(price).to.equal(expected);

    await buyBox(buyer, 15);
  });

  it("상한 구간: 9999개 판매 후 가격은 1300 USDT 고정", async () => {
    await backfill(9999n, start + DAY);  // day=1 등에 백필
    await increaseTime(DAY * 2n + 1n);   // 충분히 경과
    await syncAll();

    const p1 = await estimated(1);
    expect(p1).to.equal(1300n * ONE_USDT);

    const p10 = await estimated(10);
    expect(p10).to.equal(10n * 1300n * ONE_USDT);

    await buyBox(buyer, 3); // 3 * 1300
  });

  it("buyBox는 p.value 불일치 시 revert", async () => {
    const est = await estimated(2); // 2*350
    const wrong = est + 1n;
    const p = { ...makePermit(est), value: wrong };
    await expect(
      vesting.connect(buyer).buyBox(2, refCode, p)
    ).to.be.revertedWith("The amount to be paid is incorrect.");
  });

  it("같은 날 연속 구매: 첫 구매 후 오늘 카운터가 반영되어 다음 견적이 맞게 계산", async () => {
    // 첫 1개: 350
    const first = await buyBox(buyer, 1);
    expect(first).to.equal(350n * ONE_USDT);

    // 같은 날 바로 5개 견적: 아직 3199 언더라서 5*350
    const priceNext = await estimated(5);
    expect(priceNext).to.equal(5n * 350n * ONE_USDT);

    await buyBox(buyer, 5);
  });

  it("유효하지 않은 코드: estimatedTotalAmount=0, buyBox는 'refferal code not found'로 revert", async () => {
    const bad = "ZZZZZZZ1"; // 미할당
    const est = await vesting.estimatedTotalAmount(1, bad);
    expect(est).to.equal(0n);

    const p = makePermit(0n);
    await expect(
      vesting.connect(buyer).buyBox(1, bad, p)
    ).to.be.revertedWith("refferal code not found");
  });
});
