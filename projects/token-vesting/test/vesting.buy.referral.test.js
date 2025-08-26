// test/vesting.buy.referral.test.js
/**
 * @fileoverview TokenVesting 컨트랙트의 박스 구매 및 레퍼럴 기능 테스트
 * @description
 * - approve 경로와 permit 경로를 통한 박스 구매 테스트
 * - 레퍼럴 코드를 통한 구매 시 이벤트 발생 검증
 * - 자기추천 방지 및 잘못된 코드 형식에 대한 에러 처리 검증
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployFixture } = require("./helpers/vestingFixture");

const ONE_USDT = 10n ** 6n;

function makePermit(value, deadline = 0n, v = 0, r = ethers.ZeroHash, s = ethers.ZeroHash) {
  return { value, deadline, v, r, s };
}

describe("vesting.buy.referral", function () {
  /**
   * @test buyBox: approve 경로(deadline=0) + 이벤트
   * @description
   * - deadline=0으로 설정하여 permit을 건너뛰고 approve 기반으로 구매
   * - BoxesPurchased 이벤트가 정상적으로 발생하는지 확인
   * - 레퍼럴 코드를 통한 구매 시 이벤트 파라미터 검증
   */
  it("buyBox: approve 경로(deadline=0) + 이벤트", async () => {
    const { buyer, referrer, vesting, stableCoin, seedReferralFor } = await deployFixture();
    const refCode = await seedReferralFor(referrer); // "SPLALABS"

    // buyer에게 토큰 조금 전송 & approve (cost=0이지만 안전하게)
    // await stableCoin.connect(await ethers.getSigner()).address; // no-op
    // approve는 필수 아님(transferFrom cost=0)이지만, 프로젝트 상황에 따라 남겨둠
    await stableCoin.connect(buyer).approve(await vesting.getAddress(), ethers.MaxUint256);

    const boxCount = 2n;
    const estimated = await vesting.estimatedTotalAmount(boxCount, refCode);
    // 정책상 레퍼럴 코드가 유효해야 estimated>0
    expect(estimated).to.be.gt(0n);

    const pSkip = makePermit(estimated, 0n); // deadline=0 → permit 경로 스킵
    await expect(vesting.connect(buyer).buyBox(boxCount, refCode, pSkip))
      .to.emit(vesting, "BoxesPurchased");
  });

  /**
   * @test buyBox: permit 경로 성공
   * @description
   * - EIP-2612 permit을 통한 박스 구매 테스트
   * - 사용자가 서명한 permit 데이터로 approve 없이 구매
   */
  it("buyBox: permit 경로 성공", async () => {
    const { buyer, referrer, vesting, stableCoin, seedReferralFor } = await deployFixture();
    const refCode = await seedReferralFor(referrer);

    const boxCount = 1n;
    const estimated = await vesting.estimatedTotalAmount(boxCount, refCode);
    expect(estimated).to.be.gt(0n);

    const deadline = BigInt((await ethers.provider.getBlock("latest")).timestamp) + 3600n;

    // EIP-712 도메인
    const domain = {
      name: await stableCoin.name(),
      version: "1",
      chainId: Number((await ethers.provider.getNetwork()).chainId),
      verifyingContract: await stableCoin.getAddress(),
    };

    // EIP-712 타입
    const types = {
      Permit: [
        { name: "owner",   type: "address" },
        { name: "spender", type: "address" },
        { name: "value",   type: "uint256" },
        { name: "nonce",   type: "uint256" },
        { name: "deadline",type: "uint256" },
      ],
    };

    // 현재 nonce 조회 및 메시지 구성 (value는 반드시 estimated와 동일)
    const nonce = await stableCoin.nonces(buyer.address);
    const message = {
      owner: buyer.address,
      spender: await vesting.getAddress(),
      value: estimated,                     // ★ buyBox에서 비교하는 값과 동일해야 함
      nonce,
      deadline: Number(deadline),
    };

    // EIP-712 서명
    const sig = await buyer.signTypedData(domain, types, message);
    const { v, r, s } = ethers.Signature.from(sig);

    // permit 경로로 구매 성공
    await expect(
      vesting.connect(buyer).buyBox(boxCount, refCode, { value: estimated, deadline, v, r, s })
    ).to.emit(vesting, "BoxesPurchased");
  });

  /**
   * @test buyBox: 자기추천 금지
   * @description
   * - 사용자가 자신의 레퍼럴 코드로 구매를 시도할 때 에러 발생 확인
   */
  it("buyBox: 자기추천 금지", async () => {
    const { buyer, vesting, seedReferralFor } = await deployFixture();
    const myCode = await seedReferralFor(buyer);

    const boxCount = 1n;
    // 자기코드는 유효하므로 estimated는 0보다 큼
    const estimated = await vesting.estimatedTotalAmount(boxCount, myCode);
    const pSkip = makePermit(estimated, 0n);

    await expect(
      vesting.connect(buyer).buyBox(boxCount, myCode, pSkip)
    ).to.be.revertedWith("self referral");
  });

  /**
   * @test buyBox: 잘못된 코드 형식(길이/문자셋) revert
   * @description
   * - 8자리가 아닌 코드, 허용되지 않는 문자 포함 코드
   */
  it("buyBox: 잘못된 코드 형식(길이/문자셋) revert", async () => {
    const { buyer, vesting } = await deployFixture();
    const pZero = makePermit(0n, 0n);

    // 1) 길이 오류
    await expect(vesting.connect(buyer).buyBox(1n, "ABC", pZero))
      .to.be.revertedWith("ref len!=8");

    // 2) 문자셋 오류: 허용되지 않는 특수문자 포함
    await expect(vesting.connect(buyer).buyBox(1n, "abcd$#12", pZero))
      .to.be.reverted; // 내부에서 "ref invalid char"로 revert
  });
});
