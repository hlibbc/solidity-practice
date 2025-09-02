/**
 * @fileoverview 
 *  TokenVesting 테스트용 픽스처 헬퍼 모듈
 * @description
 *  테스트 환경에서 TokenVesting 컨트랙트와 관련 컨트랙트들을 배포하고
 *  초기 설정을 완료하는 픽스처 함수를 제공합니다.
 * 
 * 배포 대상:
 *  - StableCoin: USDT 스테이블코인 컨트랙트
 *  - TokenVesting: 베스팅 메인 컨트랙트
 *  - BadgeSBT: 소울바운드 토큰 컨트랙트
 * 
 * 초기 설정:
 *  - 베스팅 스케줄 초기화 (4년간의 베스팅 계획)
 *  - 컨트랙트 간 연결 설정
 *  - 테스트용 레퍼럴 코드 설정
 * 
 * 제공 기능:
 *  - 컨트랙트 인스턴스 및 설정값 반환
 *  - 레퍼럴 코드 시드 함수
 *  - 시간 증가 유틸리티 함수
 * 
 * 사용법:
 *  const { deployFixture } = require("./helpers/vestingFixture");
 *  const fixture = await loadFixture(deployFixture);
 * 
 * @author hlibbc
 */
const { ethers } = require("hardhat");

// =============================================================================
// 상수 정의
// =============================================================================

/**
 * @description 하루를 초 단위로 나타내는 상수
 * @constant {BigInt} DAY
 * @value 86400n
 * 
 * Unix timestamp에서 하루는 86400초
 * 베스팅 일수 계산에 사용
 */
const DAY = 86400n;

/**
 * @description USDT 1개를 6자리 소수점 단위로 나타내는 상수
 * @constant {BigInt} ONE_USDT
 * @value 1000000n
 * 
 * USDT는 6자리 소수점을 사용
 * 금액 계산 및 검증에 사용
 */
const ONE_USDT = 10n ** 6n;

// =============================================================================
// 픽스처 함수
// =============================================================================

/**
 * @description TokenVesting 테스트 환경을 구성하는 픽스처 함수
 * @returns {Promise<Object>} 테스트에 필요한 모든 컨트랙트 인스턴스와 설정값
 * 
 * 반환 객체 구조:
 *  - owner, buyer, referrer, other: 테스트용 서명자들
 *  - stableCoin: StableCoin 컨트랙트 인스턴스
 *  - sbt: BadgeSBT 컨트랙트 인스턴스
 *  - vesting: TokenVesting 컨트랙트 인스턴스
 *  - start: 베스팅 시작 시각 (epoch)
 *  - ends: 각 베스팅 단계의 종료 시각 배열
 *  - buyerTotals: 각 단계별 구매자 총 베스팅량 배열
 *  - refTotals: 각 단계별 레퍼러 총 베스팅량 배열
 *  - DAY, ONE_USDT: 상수값들
 *  - seedReferralFor: 레퍼럴 코드 시드 함수
 *  - increaseTime: 시간 증가 유틸리티 함수
 * 
 * 배포 프로세스:
 *  1. StableCoin 컨트랙트 배포
 *  2. 현재 블록 타임스탬프를 베스팅 시작 시각으로 설정
 *  3. TokenVesting 컨트랙트 배포 (forwarder, stableCoin, start)
 *  4. BadgeSBT 컨트랙트 배포 (admin = vesting)
 *  5. 컨트랙트 간 연결 설정
 *  6. 베스팅 스케줄 초기화
 * 
 * 베스팅 스케줄:
 *  - 4년간의 베스팅 계획
 *  - 각 년도별로 구매자와 레퍼러 풀 분리
 *  - 1-2년차: 구매자 170M + 87.5M, 레퍼러 15M + 15M
 *  - 3-4년차: 구매자 52.5M + 40M, 레퍼러 0 + 0
 */
async function deployFixture() {
    // === 테스트용 서명자들 획득 ===
    const [owner, buyer, referrer, other, ...rest] = await ethers.getSigners();

    // === StableCoin 배포 ===
    const StableCoin = await ethers.getContractFactory("StableCoin");
    const stableCoin = await StableCoin.deploy();

    // === 베스팅 시작 시각 설정 ===
    const now = BigInt((await ethers.provider.getBlock("latest")).timestamp);
    const start = now;

    // === TokenVesting 배포 (새 생성자: forwarder, stableCoin, start) ===
    const TV = await ethers.getContractFactory("TokenVesting");
    const vesting = await TV.deploy(
        ethers.ZeroAddress,                    // forwarder: 메타 트랜잭션용 (현재 미사용)
        await stableCoin.getAddress(),         // stableCoin: USDT 컨트랙트 주소
        start                                  // start: 베스팅 시작 시각
    );

    // === BadgeSBT 배포: admin = vesting (mint/upgrade가 onlyAdmin이므로) ===
    const BadgeSBT = await ethers.getContractFactory("BadgeSBT");
    const sbt = await BadgeSBT.deploy(
        "Badge",                               // name: SBT 토큰 이름
        "BDG",                                 // symbol: SBT 토큰 심볼
        await vesting.getAddress()             // admin: 베스팅 컨트랙트가 SBT 관리
    );

    // === TokenVesting에 SBT 주소 연결 ===
    await vesting.setBadgeSBT(await sbt.getAddress());

    // === 베스팅 스케줄 초기화 ===
    // 4년간의 베스팅 계획: 각 년도별 종료 시각
    const ends = [
        start - 1n + DAY * 365n,              // 1년차 종료 시각
        start - 1n + DAY * 365n * 2n,         // 2년차 종료 시각
        start - 1n + DAY * 365n * 3n,         // 3년차 종료 시각
        start - 1n + DAY * 365n * 4n,         // 4년차 종료 시각
    ];
    
    // 각 년도별 구매자 총 베스팅량 (18자리 소수점 단위)
    const buyerTotals = [
        ethers.parseEther("170000000"),        // 1년차: 170M 토큰
        ethers.parseEther("87500000"),         // 2년차: 87.5M 토큰
        ethers.parseEther("52500000"),         // 3년차: 52.5M 토큰
        ethers.parseEther("40000000"),         // 4년차: 40M 토큰
    ];
    
    // 각 년도별 레퍼러 총 베스팅량 (18자리 소수점 단위)
    const refTotals = [
        ethers.parseEther("15000000"),         // 1년차: 15M 토큰
        ethers.parseEther("15000000"),         // 2년차: 15M 토큰
        0n,                                    // 3년차: 0 토큰
        0n,                                    // 4년차: 0 토큰
    ];
    
    // 베스팅 스케줄 초기화 실행
    await vesting.initializeSchedule(ends, buyerTotals, refTotals);

    // =============================================================================
    // 유틸리티 함수들
    // =============================================================================

    /**
     * @description 특정 서명자에게 테스트용 레퍼럴 코드를 배정하는 함수
     * @param {Object} signer - 레퍼럴 코드를 받을 서명자 객체
     * @returns {Promise<string>} 배정된 레퍼럴 코드 ("SPLALABS")
     * 
     * 테스트에서 레퍼럴 시스템을 검증하기 위해 사용
     * "SPLALABS" 코드를 지정된 서명자에게 배정
     * 
     * 사용 예시:
     *  const code = await seedReferralFor(referrer);
     *  // referrer가 "SPLALABS" 코드를 가지게 됨
     */
    async function seedReferralFor(signer) {
        const code = "SPLALABS";
        await vesting.setReferralCode(signer.address, code, true);
        return code;
    }

    /**
     * @description 테스트 환경에서 시간을 증가시키는 함수
     * @param {BigInt|number} seconds - 증가시킬 시간 (초 단위)
     * @returns {Promise<void>}
     * 
     * Hardhat의 evm_increaseTime과 evm_mine을 사용하여
     * 테스트 환경의 블록 타임스탬프를 조작
     * 
     * 베스팅 시간 경과 시뮬레이션에 사용:
     *  - 베스팅 클레임 가능 시점 테스트
     *  - 시간 기반 로직 검증
     *  - 스케줄 진행 상황 테스트
     * 
     * 사용 예시:
     *  await increaseTime(DAY * 30n); // 30일 경과
     *  await increaseTime(365 * DAY); // 1년 경과
     */
    async function increaseTime(seconds) {
        await ethers.provider.send("evm_increaseTime", [Number(seconds)]);
        await ethers.provider.send("evm_mine", []);
    }

    // =============================================================================
    // 픽스처 반환
    // =============================================================================

    return {
        // === 서명자들 ===
        owner,                                  // 컨트랙트 소유자 (관리자)
        buyer,                                  // 구매자 역할 테스트 계정
        referrer,                               // 레퍼러 역할 테스트 계정
        other,                                  // 기타 테스트 계정
        
        // === 컨트랙트 인스턴스들 ===
        stableCoin,                             // StableCoin 컨트랙트
        sbt,                                    // BadgeSBT 컨트랙트
        vesting,                                // TokenVesting 컨트랙트
        
        // === 베스팅 설정값들 ===
        start,                                  // 베스팅 시작 시각
        ends,                                   // 각 단계별 종료 시각 배열
        buyerTotals,                            // 각 단계별 구매자 총 베스팅량
        refTotals,                              // 각 단계별 레퍼러 총 베스팅량
        
        // === 상수값들 ===
        DAY,                                    // 하루 (초 단위)
        ONE_USDT,                               // USDT 1개 (6자리 소수점)
        
        // === 유틸리티 함수들 ===
        seedReferralFor,                        // 레퍼럴 코드 시드 함수
        increaseTime                            // 시간 증가 함수
    };
}

// =============================================================================
// 모듈 내보내기
// =============================================================================

/**
 * @description 픽스처 함수를 모듈로 내보내기
 * 
 * Hardhat의 loadFixture와 함께 사용하여
 * 테스트 간 상태 격리 및 성능 최적화
 * 
 * 사용법:
 *  const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
 *  const { deployFixture } = require("./helpers/vestingFixture");
 *  
 *  describe("TokenVesting Tests", function () {
 *      it("should work", async function () {
 *          const { vesting, buyer } = await loadFixture(deployFixture);
 *          // 테스트 로직...
 *      });
 *  });
 */
module.exports = { deployFixture };
