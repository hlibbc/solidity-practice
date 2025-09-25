// test/vesting.schedule.test.js
/**
 * @fileoverview 
 *  TokenVesting 컨트랙트의 베스팅 스케줄 초기화 기능 테스트
 * @description
 *  - initializeSchedule 함수의 정상 동작 검증
 *  - 중복 초기화 방지 기능 테스트
 *  - 잘못된 파라미터에 대한 에러 처리 검증
 * 
 * 테스트 목적:
 *  - 베스팅 스케줄 초기화 시스템의 정상 동작 검증
 *  - 중복 초기화 방지를 통한 시스템 무결성 보장
 *  - 잘못된 파라미터에 대한 적절한 에러 처리 검증
 *  - 베스팅 시스템의 안전성과 신뢰성 보장
 * 
 * 베스팅 스케줄 시스템 개요:
 *  - 베스팅 기간과 토큰 수량을 정의하는 핵심 설정
 *  - 한 번 초기화되면 변경 불가능한 불변 구조
 *  - 시간 순서와 수량의 일관성 검증
 *  - 시스템 초기화 상태 관리
 * 
 * @author hlibbc
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployFixture } = require("./helpers/vestingFixture");

// =============================================================================
// 베스팅 스케줄 초기화 기능 테스트
// =============================================================================

/**
 * @describe 베스팅 스케줄 초기화 기능 테스트
 * @description 
 *  1. 정상적인 스케줄 초기화 검증
 *  2. 중복 초기화 시도 시 에러 발생 확인
 *  3. 잘못된 파라미터에 대한 에러 처리 검증
 * 
 * 테스트 시나리오:
 *  - 정상적인 스케줄 초기화 및 상태 검증
 *  - 중복 초기화 시도 시 보안 기능 검증
 *  - 다양한 잘못된 파라미터에 대한 에러 처리 검증
 * 
 * 검증 항목:
 *  - scheduleInitialized 상태 확인
 *  - poolEndTimes 설정 검증
 *  - nextSyncTs 설정 검증
 *  - 중복 초기화 방지 기능
 *  - 파라미터 유효성 검증
 */
describe("vesting.schedule", function () {

    // =============================================================================
    // 정상적인 스케줄 초기화 테스트
    // =============================================================================

    /**
     * @test initializeSchedule: 정상 초기화
     * @description 
     *  - 베스팅 스케줄이 정상적으로 초기화되는지 확인
     *  - scheduleInitialized 상태가 true로 설정되는지 검증
     *  - poolEndTimes와 nextSyncTs가 올바르게 설정되는지 확인
     * 
     * 테스트 시나리오:
     *  1. deployFixture를 통한 테스트 환경 구성
     *  2. 스케줄 초기화 완료 상태 확인
     *  3. poolEndTimes 설정 검증
     *  4. nextSyncTs 설정 검증
     * 
     * 검증 포인트:
     *  - scheduleInitialized가 true로 설정되었는지
     *  - poolEndTimes[0]이 0보다 큰 값으로 설정되었는지
     *  - nextSyncTs가 0이 아닌 값으로 설정되었는지
     *  - 베스팅 시스템이 정상적으로 초기화되었는지
     */
    it("initializeSchedule: 정상 초기화", async () => {
        // === 테스트 환경 구성 ===
        const { vesting, ends, buyerTotals, refTotals } = await deployFixture();
        
        // === 스케줄 초기화 완료 상태 확인 ===
        expect(await vesting.scheduleInitialized()).to.equal(true);
        
        // === 간단 검증: poolEndTimes 길이와 nextSyncTs 설정 확인 ===
        // poolEndTimes[0]이 0보다 큰 값인지 확인 (베스팅 종료 시각이 설정되었는지)
        expect((await vesting.poolEndTimes(0)) > 0n).to.equal(true);
        // nextSyncTs가 0이 아닌 값인지 확인 (다음 동기화 시각이 설정되었는지)
        expect(await vesting.nextSyncTs()).to.not.equal(0n);
    });

    // =============================================================================
    // 중복 초기화 방지 기능 테스트
    // =============================================================================

    /**
     * @test initializeSchedule: 재호출 불가
     * @description 
     *  - 이미 초기화된 스케줄에 대해 재호출 시 에러 발생 확인
     *  - "schedule inited" 에러 메시지 검증
     * 
     * 보안 목적:
     *  - 베스팅 스케줄의 불변성 보장
     *  - 중복 초기화를 통한 시스템 조작 방지
     *  - 베스팅 시스템의 무결성 유지
     * 
     * 테스트 시나리오:
     *  1. deployFixture를 통한 이미 초기화된 환경 구성
     *  2. 동일한 파라미터로 재초기화 시도
     *  3. "schedule inited" 에러 발생 확인
     * 
     * 검증 포인트:
     *  - 이미 초기화된 스케줄에 대한 재호출 시도 시 에러 발생
     *  - 적절한 에러 메시지("schedule inited") 반환
     *  - 시스템 상태가 변경되지 않음
     */
    it("initializeSchedule: 재호출 불가", async () => {
        // === 테스트 환경 구성 ===
        const { vesting, ends, buyerTotals, refTotals } = await deployFixture();
        
        // === 이미 초기화된 스케줄에 대해 재호출 시 에러 발생 ===
        await expect(
            vesting.initializeSchedule(ends, buyerTotals, refTotals)
        ).to.be.revertedWith("schedule inited");
    });

    // =============================================================================
    // 잘못된 파라미터에 대한 에러 처리 테스트
    // =============================================================================

    /**
     * @test initializeSchedule: 실패 케이스(길이/증가/시작전)
     * @description 
     *  - 잘못된 파라미터에 대한 에러 처리 검증
     *  - 배열 길이 불일치, 증가하지 않는 시각, 시작 시각 이전 종료 시각 등
     * 
     * 검증하는 에러 케이스:
     *  1. 배열 길이 불일치: ends, buyerTotals, refTotals 배열의 길이가 서로 다른 경우
     *  2. 증가하지 않는 시각: poolEndTimes가 시간 순서대로 증가하지 않는 경우
     *  3. 시작 시각 이전 종료 시각: 베스팅 시작 시각보다 이전에 종료되는 경우
     * 
     * 테스트 시나리오:
     *  1. 새로운 테스트 환경 구성 (기존 fixture 사용하지 않음)
     *  2. 다양한 잘못된 파라미터로 초기화 시도
     *  3. 각각의 경우에 대해 적절한 에러 발생 확인
     *  4. 정상적인 파라미터로 초기화 성공 확인
     * 
     * 보안 목적:
     *  - 잘못된 설정으로 인한 시스템 오류 방지
     *  - 베스팅 스케줄의 논리적 일관성 보장
     *  - 시스템의 안정성과 예측 가능성 보장
     */
    it("initializeSchedule: 실패 케이스(길이/증가/시작전)", async () => {
        // === 테스트용 계정 및 컨트랙트 준비 ===
        const StableCoin = await ethers.getContractFactory("StableCoin");
        const stableCoin = await StableCoin.deploy();
        await stableCoin.waitForDeployment();

        // === TokenVesting 배포 (새 생성자: forwarder, stableCoin, start) ===
        const now = BigInt((await ethers.provider.getBlock("latest")).timestamp);
        const TV = await ethers.getContractFactory('TokenVesting');
        const vesting = await TV.deploy(
            ethers.ZeroAddress, // forwarder: ZeroAddress
            await stableCoin.getAddress(), // stableCoin: StableCoin 컨트랙트 주소
            now // start: 현재 블록 타임스탬프
        );
        await vesting.waitForDeployment();

        // === BadgeSBT 배포: admin = vesting (mint/upgrade가 onlyAdmin이므로) ===
        const BadgeSBT = await ethers.getContractFactory('BadgeSBT');
        const sbt = await BadgeSBT.deploy("Badge", "BDG", await vesting.getAddress());
        await sbt.waitForDeployment();
        let sbtAddr = await sbt.getAddress();

        const Resolver = await ethers.getContractFactory('BadgeSbtTierUriResolver');
        const resolver = await Resolver.deploy(sbtAddr);
        await resolver.waitForDeployment();
        let resolverAddr = await resolver.getAddress();
        await sbt.setResolver(resolverAddr);

        // === TokenVesting에 SBT 주소 연결 ===
        await vesting.setBadgeSBT(await sbt.getAddress());

        // === 테스트용 파라미터 설정 ===
        const ends_ok = [ 
            now - 1n + 86400n,        // 정상: 증가하는 시각 (1일 후)
            now - 1n + 86400n * 2n    // 정상: 증가하는 시각 (2일 후)
        ];
        const ends_bad_len = [ 
            now - 1n + 86400n         // 잘못됨: 배열 길이 불일치 (1개만)
        ];
        const buyerTotals = [1n, 2n]; // 2개 요소
        const refTotals = [1n, 2n];   // 2개 요소

        // === 1) 배열 길이 불일치 에러 테스트 ===
        // ends_bad_len은 1개 요소, buyerTotals와 refTotals는 2개 요소
        // "len mismatch" 에러가 발생해야 함
        await expect(vesting.initializeSchedule(ends_bad_len, buyerTotals, refTotals))
            .to.be.revertedWith("len mismatch");

        // === 2) 증가하지 않는 시각 에러 테스트 (내림차순) ===
        // ends_bad_increasing: [2일 후, 1일 후] - 시간 순서가 감소하는 경우
        const ends_bad_increasing = [ 
            now - 1n + 86400n * 2n,   // 2일 후
            now - 1n + 86400n          // 1일 후 (감소하는 시각)
        ];
        // "not increasing" 에러가 발생해야 함
        await expect(vesting.initializeSchedule(ends_bad_increasing, buyerTotals, refTotals))
            .to.be.revertedWith("not increasing");

        // === 3) 시작 시각 이전 종료 시각 에러 테스트 ===
        // ends_bad_start: [시작 시각 이전, 1일 후] - end <= start 조건 위반
        const ends_bad_start = [ 
            now - 1000n,               // 시작 시각보다 1000초 이전
            now - 1n + 86400n          // 1일 후
        ];
        // "end<=start" 에러가 발생해야 함
        await expect(vesting.initializeSchedule(ends_bad_start, buyerTotals, refTotals))
            .to.be.revertedWith("end<=start");

        // === 정상 케이스: 에러가 발생하지 않아야 함 ===
        // ends_ok: [1일 후, 2일 후] - 시간 순서대로 증가하는 정상적인 경우
        await expect(vesting.initializeSchedule(ends_ok, buyerTotals, refTotals)).to.not.be.reverted;
    });
});
