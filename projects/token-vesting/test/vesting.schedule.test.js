// test/vesting.schedule.test.js
/**
 * @fileoverview TokenVesting 컨트랙트의 베스팅 스케줄 초기화 기능 테스트
 * @description 
 * - initializeSchedule 함수의 정상 동작 검증
 * - 중복 초기화 방지 기능 테스트
 * - 잘못된 파라미터에 대한 에러 처리 검증
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployFixture } = require("./helpers/vestingFixture");

/**
 * @describe 베스팅 스케줄 초기화 기능 테스트
 * @description 
 * 1. 정상적인 스케줄 초기화 검증
 * 2. 중복 초기화 시도 시 에러 발생 확인
 * 3. 잘못된 파라미터에 대한 에러 처리 검증
 */
describe("vesting.schedule", function () {

  /**
   * @test initializeSchedule: 정상 초기화
   * @description 
   * - 베스팅 스케줄이 정상적으로 초기화되는지 확인
   * - scheduleInitialized 상태가 true로 설정되는지 검증
   * - poolEndTimes와 nextSyncTs가 올바르게 설정되는지 확인
   */
  it("initializeSchedule: 정상 초기화", async () => {
    const { vesting, ends, buyerTotals, refTotals } = await deployFixture();
    
    // 스케줄 초기화 완료 상태 확인
    expect(await vesting.scheduleInitialized()).to.equal(true);
    
    // 간단 검증: poolEndTimes 길이와 nextSyncTs 설정 확인
    expect((await vesting.poolEndTimes(0)) > 0n).to.equal(true);
    expect(await vesting.nextSyncTs()).to.not.equal(0n);
  });

  /**
   * @test initializeSchedule: 재호출 불가
   * @description 
   * - 이미 초기화된 스케줄에 대해 재호출 시 에러 발생 확인
   * - "schedule inited" 에러 메시지 검증
   */
  it("initializeSchedule: 재호출 불가", async () => {
    const { vesting, ends, buyerTotals, refTotals } = await deployFixture();
    
    // 이미 초기화된 스케줄에 대해 재호출 시 에러 발생
    await expect(
      vesting.initializeSchedule(ends, buyerTotals, refTotals)
    ).to.be.revertedWith("schedule inited");
  });

  /**
   * @test initializeSchedule: 실패 케이스(길이/증가/시작전)
   * @description 
   * - 잘못된 파라미터에 대한 에러 처리 검증
   * - 배열 길이 불일치, 증가하지 않는 시각, 시작 시각 이전 종료 시각 등
   */
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

    // 테스트용 파라미터 설정
    const ends_ok = [ now - 1n + 86400n, now - 1n + 86400n * 2n ]; // 정상: 증가하는 시각
    const ends_bad_len = [ now - 1n + 86400n ]; // 잘못됨: 배열 길이 불일치
    const buyerTotals = [1n, 2n];
    const refTotals   = [1n, 2n];

    // 1) 배열 길이 불일치 에러 테스트
    await expect(vesting.initializeSchedule(ends_bad_len, buyerTotals, refTotals))
      .to.be.revertedWith("len mismatch");

    // 2) 증가하지 않는 시각 에러 테스트 (내림차순)
    const ends_bad_increasing = [ now - 1n + 86400n * 2n, now - 1n + 86400n ];
    await expect(vesting.initializeSchedule(ends_bad_increasing, buyerTotals, refTotals))
      .to.be.revertedWith("not increasing");

    // 3) 시작 시각 이전 종료 시각 에러 테스트
    const ends_bad_start = [ now - 1000n, now - 1n + 86400n ]; // end<=start
    await expect(vesting.initializeSchedule(ends_bad_start, buyerTotals, refTotals))
      .to.be.revertedWith("end<=start");

    // 정상 케이스: 에러가 발생하지 않아야 함
    await expect(vesting.initializeSchedule(ends_ok, buyerTotals, refTotals)).to.not.be.reverted;
  });
});
