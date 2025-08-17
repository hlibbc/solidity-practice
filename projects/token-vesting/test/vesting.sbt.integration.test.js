// test/vesting.sbt.integration.test.js
/**
 * @fileoverview TokenVesting과 BadgeSBT 컨트랙트 간의 통합 테스트
 * @description 
 * - SBT 토큰의 자동 민팅 및 등급 업그레이드 기능 테스트
 * - 구매량 증가에 따른 등급 상승 검증
 * - 관리자 권한 설정의 중요성 검증
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * @describe TokenVesting과 BadgeSBT 컨트랙트 간의 통합 테스트
 * @description 
 * 1. SBT 토큰의 자동 민팅 기능 테스트
 * 2. 구매량 증가에 따른 등급 업그레이드 테스트
 * 3. 관리자 권한 설정의 중요성 검증
 */
describe("TokenVesting ↔ BadgeSBT integration", function () {
  const ONE_DAY = 86400n; // 하루를 초 단위로 표현
  const addr = (c) => (c?.target ?? c?.address); // 컨트랙트 주소 추출 헬퍼

  let owner, buyer, referrer, other;
  before(async () => {
    [owner, buyer, referrer, other] = await ethers.getSigners();
  });

  /**
   * @notice TokenVesting과 BadgeSBT 컨트랙트를 배포하고 연결하는 헬퍼 함수
   * @returns {vesting, sbt, start} 배포된 컨트랙트들과 베스팅 시작 시각
   * @description 
   * 1. TokenVesting 컨트랙트 배포 (forwarder = ZeroAddress, stableCoin = owner 주소)
   * 2. BadgeSBT 컨트랙트 배포 (admin = owner)
   * 3. Vesting ↔ SBT 연결 및 admin 권한 이관
   * 4. 베스팅 스케줄 초기화 (30일간 100만 토큰)
   */
  async function deployVestingAndSBT() {
    const blk = await ethers.provider.getBlock("latest");
    const now = BigInt(blk.timestamp);
    const start = now - (now % ONE_DAY); // 자정 정렬

    // 1) TokenVesting (forwarder = ZeroAddress, stableCoin = owner 주소로 대충 채움)
    const Vesting = await ethers.getContractFactory("TokenVesting");
    const vesting = await Vesting.deploy(ethers.ZeroAddress, owner.address, start);
    await vesting.waitForDeployment();

    // 2) BadgeSBT (admin = owner)
    const BadgeSBT = await ethers.getContractFactory("BadgeSBT");
    const sbt = await BadgeSBT.deploy("Badge", "BDG", owner.address);
    await sbt.waitForDeployment();

    // 3) Vesting ↔ SBT 연결 + admin 이관
    // TokenVesting이 BadgeSBT를 관리할 수 있도록 admin 권한 이관
    await vesting.connect(owner).setBadgeSBT(addr(sbt));
    await sbt.connect(owner).setAdmin(addr(vesting));

    // 4) 스케줄: 30일간 100만 토큰 베스팅
    const poolEnd = start + ONE_DAY * 30n;
    const buyerTotal = ethers.parseUnits("1000000", 18);
    const refTotal = 0n;
    await vesting.initializeSchedule([poolEnd], [buyerTotal], [refTotal]);

    return { vesting, sbt, start };
  }

  /**
   * @notice 테스트용 구매 데이터를 백필하는 헬퍼 함수
   * @param vesting TokenVesting 컨트랙트 인스턴스
   * @param buyerAddr 구매자 주소
   * @param start 베스팅 시작 시각
   * @param dayOffset 시작일로부터의 일수 오프셋
   * @param boxCount 구매할 박스 수량
   * @returns 백필 트랜잭션
   * @description 
   * - 레퍼럴 코드는 빈 문자열 (레퍼럴 없음)
   * - 결제 금액은 0 (테스트용)
   * - 바이백 적립은 false
   */
  function backfill(vesting, buyerAddr, start, dayOffset, boxCount) {
    const purchaseTs = start + ONE_DAY * BigInt(dayOffset);
    return vesting
      .connect(owner)
      .backfillPurchaseAt(buyerAddr, "", boxCount, purchaseTs, 0, false);
  }

  /**
   * @test 첫 번째 구매 시 SBT 토큰 자동 민팅
   * @description 
   * - 사용자가 첫 번째 박스를 구매할 때 자동으로 SBT 토큰이 민팅되는지 확인
   * - 민팅된 토큰의 소유권과 초기 등급, URI 검증
   */
  it("mints SBT on first purchase", async function () {
    const { vesting, sbt, start } = await deployVestingAndSBT();

    // 첫 번째 구매: 100개 박스
    await backfill(vesting, buyer.address, start, 0, 100);

    // SBT 토큰 ID 확인: 0보다 큰 값이어야 함
    const tokenId = await vesting.sbtIdOf(buyer.address);
    expect(tokenId).to.be.gt(0n);

    // 실제 소유권 확인: BadgeSBT 컨트랙트에서 소유자 조회
    const realOwner = await sbt.ownerOf(tokenId);
    expect(realOwner).to.equal(buyer.address);

    // 초기 등급 확인: Tier 1 (Bronze)
    const t1 = await sbt.currentTier(tokenId);
    expect(t1).to.equal(1n);

    // 토큰 URI 확인: 빈 문자열이 아니어야 함
    const uri1 = await sbt.tokenURI(tokenId);
    expect(uri1).to.be.a("string").and.not.equal("");
  });

  /**
   * @test 총 박스 수량 증가에 따른 등급 업그레이드
   * @description 
   * - 구매량이 임계값을 넘을 때마다 등급이 자동으로 상승하는지 확인
   * - 각 등급별로 다른 URI가 설정되는지 검증
   * - 등급 상승 시 이전 URI와 다른 URI로 변경되는지 확인
   */
  it("upgrades tier as total box count crosses thresholds", async function () {
    const { vesting, sbt, start } = await deployVestingAndSBT();

    // 1차 구매: 100개 박스 → Tier 1 (Bronze)
    await backfill(vesting, buyer.address, start, 0, 100);
    const tokenId = await vesting.sbtIdOf(buyer.address);

    let tier = await sbt.currentTier(tokenId);
    expect(tier).to.equal(1n);
    const uri1 = await sbt.tokenURI(tokenId);
    expect(uri1).to.be.a("string").and.not.equal("");

    // 2차 구매: 4900개 박스 추가 (총 5000개) → Tier 2 (Silver)
    await backfill(vesting, buyer.address, start, 1, 4900);
    tier = await sbt.currentTier(tokenId);
    expect(tier).to.equal(2n);
    const uri2 = await sbt.tokenURI(tokenId);
    expect(uri2).to.not.equal(uri1); // URI가 변경되어야 함

    // 3차 구매: 10000개 박스 추가 (총 15000개) → Tier 3 (Gold)
    await backfill(vesting, buyer.address, start, 2, 10000);
    tier = await sbt.currentTier(tokenId);
    expect(tier).to.equal(3n);
    const uri3 = await sbt.tokenURI(tokenId);
    expect(uri3).to.not.equal(uri2); // URI가 변경되어야 함

    // 4차 구매: 10000개 박스 추가 (총 25000개) → Tier 4 (Platinum)
    await backfill(vesting, buyer.address, start, 3, 10000);
    tier = await sbt.currentTier(tokenId);
    expect(tier).to.equal(4n);
    const uri4 = await sbt.tokenURI(tokenId);
    expect(uri4).to.not.equal(uri3); // URI가 변경되어야 함
  });

  /**
   * @test SBT admin이 TokenVesting이 아닌 경우 민팅/업그레이드 실패
   * @description 
   * - BadgeSBT의 admin이 TokenVesting이 아닌 경우
   * - SBT 토큰 민팅 및 업그레이드가 실패하는지 확인
   * - NotAdmin 커스텀 에러가 발생하는지 검증
   */
  it("reverts if SBT admin is NOT TokenVesting (no mint/upgrade)", async function () {
    const blk = await ethers.provider.getBlock("latest");
    const now = BigInt(blk.timestamp);
    const start = now - (now % ONE_DAY);

    // Vesting: forwarder = ZeroAddress (중요!)
    const Vesting = await ethers.getContractFactory("TokenVesting");
    const vesting = await Vesting.deploy(ethers.ZeroAddress, owner.address, start);
    await vesting.waitForDeployment();

    // SBT: admin=owner (이관하지 않음)
    const BadgeSBT = await ethers.getContractFactory("BadgeSBT");
    const sbt = await BadgeSBT.deploy("Badge", "BDG", owner.address);
    await sbt.waitForDeployment();

    // SBT 주소만 세팅 (admin 이관 X)
    // 이 경우 TokenVesting이 BadgeSBT를 관리할 수 없음
    await vesting.connect(owner).setBadgeSBT(addr(sbt));

    const poolEnd = start + ONE_DAY * 10n;
    await vesting.initializeSchedule([poolEnd], [ethers.parseUnits("1", 18)], [0]);

    // 구매 시도 시 NotAdmin 에러 발생해야 함
    await expect(backfill(vesting, buyer.address, start, 0, 123))
      .to.be.revertedWithCustomError(sbt, "NotAdmin");
  });
});
