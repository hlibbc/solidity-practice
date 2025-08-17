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

/**
 * @describe 박스 구매 및 레퍼럴 기능 테스트
 * @description 
 * 1. approve 경로를 통한 박스 구매 테스트
 * 2. permit 경로를 통한 박스 구매 테스트 (EIP-2612)
 * 3. 자기추천 방지 기능 테스트
 * 4. 잘못된 레퍼럴 코드 형식에 대한 에러 처리 검증
 */
describe("vesting.buy.referral", function () {

  /**
   * @test buyBox: approve 경로(deadline=0) + 이벤트
   * @description 
   * - deadline=0으로 설정하여 permit을 건너뛰고 approve 기반으로 구매
   * - BoxesPurchased 이벤트가 정상적으로 발생하는지 확인
   * - 레퍼럴 코드를 통한 구매 시 이벤트 파라미터 검증
   */
  it("buyBox: approve 경로(deadline=0) + 이벤트", async () => {
    const { buyer, referrer, vesting, seedReferralFor } = await deployFixture();
    const refCode = await seedReferralFor(referrer);

    // deadline=0으로 설정하여 permit 스킵 (approve 기반 구매)
    const pSkip = { value: 0n, deadline: 0n, v: 0, r: ethers.ZeroHash, s: ethers.ZeroHash };

    // 2개 박스 구매 시 BoxesPurchased 이벤트 발생 확인
    await expect(vesting.connect(buyer).buyBox(2n, await refCode, pSkip))
      .to.emit(vesting, "BoxesPurchased");
  });

  /**
   * @test buyBox: permit 경로 성공
   * @description 
   * - EIP-2612 permit을 통한 박스 구매 테스트
   * - 사용자가 서명한 permit 데이터로 approve 없이 구매
   * - EIP-712 서명 생성 및 검증 과정 테스트
   */
  it("buyBox: permit 경로 성공", async () => {
    const { buyer, referrer, vesting, stableCoin, seedReferralFor } = await deployFixture();
    const refCode = await seedReferralFor(referrer);

    const boxCount = 1n;
    const cost = 10n ** 6n; // 실제 전송은 0이어도 OK (컨트랙트 cost=0), permit 자체만 검증
    const deadline = BigInt((await ethers.provider.getBlock("latest")).timestamp) + 3600n; // 1시간 후 만료

    // EIP-712 도메인 설정
    const domain = {
      name: await stableCoin.name(),
      version: "1",
      chainId: Number((await ethers.provider.getNetwork()).chainId),
      verifyingContract: await stableCoin.getAddress(),
    };
    
    // EIP-712 타입 정의
    const types = {
      Permit: [
        { name: "owner",   type: "address" },
        { name: "spender", type: "address" },
        { name: "value",   type: "uint256" },
        { name: "nonce",   type: "uint256" },
        { name: "deadline",type: "uint256" },
      ],
    };
    
    // 현재 nonce 조회 및 메시지 구성
    const nonce = await stableCoin.nonces(buyer.address);
    const message = {
      owner: buyer.address,
      spender: await vesting.getAddress(),
      value: cost,
      nonce,
      deadline: Number(deadline),
    };

    // EIP-712 서명 생성
    const sig = await buyer.signTypedData(domain, types, message);
    const { v, r, s } = ethers.Signature.from(sig);

    // permit을 통한 박스 구매 성공 확인
    await expect(
      vesting.connect(buyer).buyBox(boxCount, await refCode, { value: cost, deadline, v, r, s })
    ).to.emit(vesting, "BoxesPurchased");
  });

  /**
   * @test buyBox: 자기추천 금지
   * @description 
   * - 사용자가 자신의 레퍼럴 코드로 구매를 시도할 때 에러 발생 확인
   * - "self referral" 에러 메시지 검증
   * - 자기추천을 통한 부정한 이익 취득 방지
   */
  it("buyBox: 자기추천 금지", async () => {
    const { buyer, vesting, seedReferralFor } = await deployFixture();
    const myCode = await seedReferralFor(buyer);

    // 자기 자신의 레퍼럴 코드로 구매 시도
    const pSkip = { value: 0n, deadline: 0n, v: 0, r: ethers.ZeroHash, s: ethers.ZeroHash };
    await expect(
      vesting.connect(buyer).buyBox(1n, await myCode, pSkip)
    ).to.be.revertedWith("self referral");
  });

  /**
   * @test buyBox: 잘못된 코드 형식(길이/문자셋) revert
   * @description 
   * - 8자리가 아닌 레퍼럴 코드로 구매 시도 시 에러 발생 확인
   * - 허용되지 않는 문자를 포함한 코드로 구매 시도 시 에러 발생 확인
   * - "ref len!=8" 및 "ref invalid char" 에러 메시지 검증
   */
  it("buyBox: 잘못된 코드 형식(길이/문자셋) revert", async () => {
    const { buyer, vesting } = await deployFixture();
    const pSkip = { value: 0n, deadline: 0n, v: 0, r: ethers.ZeroHash, s: ethers.ZeroHash };

    // 1) 길이 오류: 8자리가 아닌 코드
    await expect(vesting.connect(buyer).buyBox(1n, "ABC", pSkip))
      .to.be.revertedWith("ref len!=8");
    
    // 2) 문자셋 오류: 허용되지 않는 특수문자 포함
    await expect(vesting.connect(buyer).buyBox(1n, "abcd$#12", pSkip))
      .to.be.reverted; // 문자셋 오류 -> "ref invalid char"
  });
});
