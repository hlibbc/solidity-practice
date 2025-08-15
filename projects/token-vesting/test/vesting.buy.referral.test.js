// test/vesting.buy.referral.test.js
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployFixture } = require("./helpers/vestingFixture");

describe("vesting.buy.referral", function () {

  it("buyBox: approve 경로(deadline=0) + 이벤트", async () => {
    const { buyer, referrer, vesting, seedReferralFor } = await deployFixture();
    const refCode = await seedReferralFor(referrer);

    const pSkip = { value: 0n, deadline: 0n, v: 0, r: ethers.ZeroHash, s: ethers.ZeroHash };

    await expect(vesting.connect(buyer).buyBox(2n, await refCode, pSkip))
      .to.emit(vesting, "BoxesPurchased");
  });

  it("buyBox: permit 경로 성공", async () => {
    const { buyer, referrer, vesting, usdt, seedReferralFor } = await deployFixture();
    const refCode = await seedReferralFor(referrer);

    const boxCount = 1n;
    const cost = 10n ** 6n; // 실제 전송은 0이어도 OK (컨트랙트 cost=0), permit 자체만 검증
    const deadline = BigInt((await ethers.provider.getBlock("latest")).timestamp) + 3600n;

    const domain = {
      name: await usdt.name(),
      version: "1",
      chainId: Number((await ethers.provider.getNetwork()).chainId),
      verifyingContract: await usdt.getAddress(),
    };
    const types = {
      Permit: [
        { name: "owner",   type: "address" },
        { name: "spender", type: "address" },
        { name: "value",   type: "uint256" },
        { name: "nonce",   type: "uint256" },
        { name: "deadline",type: "uint256" },
      ],
    };
    const nonce = await usdt.nonces(buyer.address);
    const message = {
      owner: buyer.address,
      spender: await vesting.getAddress(),
      value: cost,
      nonce,
      deadline: Number(deadline),
    };

    const sig = await buyer.signTypedData(domain, types, message);
    const { v, r, s } = ethers.Signature.from(sig);

    await expect(
      vesting.connect(buyer).buyBox(boxCount, await refCode, { value: cost, deadline, v, r, s })
    ).to.emit(vesting, "BoxesPurchased");
  });

  it("buyBox: 자기추천 금지", async () => {
    const { buyer, vesting, seedReferralFor } = await deployFixture();
    const myCode = await seedReferralFor(buyer);

    const pSkip = { value: 0n, deadline: 0n, v: 0, r: ethers.ZeroHash, s: ethers.ZeroHash };
    await expect(
      vesting.connect(buyer).buyBox(1n, await myCode, pSkip)
    ).to.be.revertedWith("self referral");
  });

  it("buyBox: 잘못된 코드 형식(길이/문자셋) revert", async () => {
    const { buyer, vesting } = await deployFixture();
    const pSkip = { value: 0n, deadline: 0n, v: 0, r: ethers.ZeroHash, s: ethers.ZeroHash };

    await expect(vesting.connect(buyer).buyBox(1n, "ABC", pSkip))
      .to.be.revertedWith("ref len!=8");
    await expect(vesting.connect(buyer).buyBox(1n, "abcd$#12", pSkip))
      .to.be.reverted; // 문자셋 오류 -> "ref invalid char"
  });
});
