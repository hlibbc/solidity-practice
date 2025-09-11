// test/vesting.buy.referral.test.js
/**
 * @fileoverview 
 *  TokenVesting 컨트랙트의 박스 구매 및 레퍼럴 기능 테스트
 * @description
 *  - approve 경로와 permit 경로를 통한 박스 구매 테스트
 *  - 레퍼럴 코드를 통한 구매 시 이벤트 발생 검증
 *  - 자기추천 방지 및 잘못된 코드 형식에 대한 에러 처리 검증
 * 
 * 테스트 목적:
 *  - 두 가지 구매 경로(approve/permit)의 정상 동작 검증
 *  - 레퍼럴 시스템의 정확한 작동 확인
 *  - 보안 기능(자기추천 방지, 코드 형식 검증) 테스트
 *  - EIP-2612 permit 기능의 정상 동작 검증
 * 
 * @author hlibbc
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployFixture } = require("./helpers/vestingFixture");

// =============================================================================
// 상수 및 유틸리티 함수들
// =============================================================================

/**
 * @notice USDT의 최소 단위 (6자리 소수점)
 * 1 USDT = 1,000,000 (10^6)
 */
const ONE_USDT = 10n ** 6n;

/**
 * @notice permit 데이터를 생성하는 헬퍼 함수
 * @param {bigint} value - 허용할 토큰 수량
 * @param {bigint} deadline - 허용 만료 시간 (0이면 permit 경로 스킵)
 * @param {number} v - 서명의 v 값 (기본값: 0)
 * @param {string} r - 서명의 r 값 (기본값: ZeroHash)
 * @param {string} s - 서명의 s 값 (기본값: ZeroHash)
 * @returns {Object} permit 데이터 객체
 * 
 * 용도: deadline=0으로 설정하면 approve 경로를 사용하고,
 *       유효한 deadline과 서명을 설정하면 permit 경로를 사용
 */
function makePermit(value, deadline = 0n, v = 0, r = ethers.ZeroHash, s = ethers.ZeroHash) {
    return { value, deadline, v, r, s };
}

// =============================================================================
// 박스 구매 및 레퍼럴 기능 테스트 스위트
// =============================================================================

/**
 * @describe 박스 구매 및 레퍼럴 기능 테스트
 * @description 
 *  - approve 경로와 permit 경로를 통한 박스 구매 테스트
 *  - 레퍼럴 코드를 통한 구매 시 이벤트 발생 검증
 *  - 자기추천 방지 및 잘못된 코드 형식에 대한 에러 처리 검증
 * 
 * 테스트 시나리오:
 *  1. approve 경로를 통한 박스 구매 (deadline=0)
 *  2. permit 경로를 통한 박스 구매 (EIP-2612)
 *  3. 자기추천 방지 기능 테스트
 *  4. 잘못된 레퍼럴 코드 형식 검증
 */
describe("vesting.buy.referral", function () {
    // =============================================================================
    // approve 경로를 통한 박스 구매 테스트
    // =============================================================================

    /**
     * @test buyBox: approve 경로(deadline=0) + 이벤트
     * @description
     *  - deadline=0으로 설정하여 permit을 건너뛰고 approve 기반으로 구매
     *  - BoxesPurchased 이벤트가 정상적으로 발생하는지 확인
     *  - 레퍼럴 코드를 통한 구매 시 이벤트 파라미터 검증
     * 
     * 테스트 단계:
     *  1. buyer에게 토큰 approve 설정
     *  2. 레퍼럴 코드를 통한 박스 구매
     *  3. BoxesPurchased 이벤트 발생 확인
     * 
     * 예상 결과:
     *  - 구매가 성공적으로 완료됨
     *  - BoxesPurchased 이벤트가 발생함
     *  - 레퍼럴 코드가 정상적으로 적용됨
     */
    it("buyBox: approve 경로(deadline=0) + 이벤트", async () => {
        // === 테스트 환경 설정 ===
        const { owner, buyer, referrer, vesting, stableCoin, seedReferralFor } = await deployFixture();
        const refCode = await seedReferralFor(referrer); // "SPLALABS"

        // ★ recipient 사전 설정 (미설정 시 'recipient not set'로 먼저 revert)
        await vesting.connect(owner).setRecipient(owner.address);

        const boxCount = 2n;
        const estimated = await vesting.estimatedTotalAmount(boxCount, refCode);
        expect(estimated).to.be.gt(0n);

        // ★ buyer 잔액 확보 (없으면 transferFrom 단계에서 ERC20InsufficientBalance)
        if (stableCoin.mint) {
            await stableCoin.mint(buyer.address, estimated);
        } else {
            await stableCoin.connect(owner).transfer(buyer.address, estimated);
        }

        // approve는 안전하게 Max로
        await stableCoin.connect(buyer).approve(await vesting.getAddress(), ethers.MaxUint256);

        // deadline=0 → permit 경로 스킵, approve 기반 구매
        const pSkip = { value: estimated, deadline: 0n, v: 0, r: ethers.ZeroHash, s: ethers.ZeroHash };
        await expect(
            vesting.connect(buyer).buyBox(boxCount, refCode, pSkip)
        ).to.emit(vesting, "BoxesPurchased");
    });


    // =============================================================================
    // permit 경로를 통한 박스 구매 테스트
    // =============================================================================

    /**
     * @test buyBox: permit 경로 성공
     * @description
     *  - EIP-2612 permit을 통한 박스 구매 테스트
     *  - 사용자가 서명한 permit 데이터로 approve 없이 구매
     *  - EIP-712 서명 검증 및 permit 기능 정상 동작 확인
     * 
     * 테스트 단계:
     *  1. EIP-712 도메인 및 타입 정의
     *  2. permit 메시지 구성 및 서명
     *  3. permit 경로로 박스 구매 실행
     *  4. BoxesPurchased 이벤트 발생 확인
     * 
     * EIP-2612 특징:
     *  - approve 없이 서명만으로 토큰 사용 허용
     *  - 메타트랜잭션 지원으로 가스비 절약
     *  - 보안을 위한 deadline 설정
     */
    it("buyBox: permit 경로 성공", async () => {
        // === 테스트 환경 설정 ===
        const { owner, buyer, referrer, vesting, stableCoin, seedReferralFor } = await deployFixture();
        const refCode = await seedReferralFor(referrer);

        const boxCount = 1n;
        const estimated = await vesting.estimatedTotalAmount(boxCount, refCode);
        expect(estimated).to.be.gt(0n);

        // ★ recipient 사전 설정
        await vesting.connect(owner).setRecipient(owner.address);

        // ★ buyer 잔액 확보 (permit 후 transferFrom 단계에서 필요)
        if (stableCoin.mint) {
            await stableCoin.mint(buyer.address, estimated);
        } else {
            await stableCoin.connect(owner).transfer(buyer.address, estimated);
        }

        // === EIP-712 도메인 / 타입 / 메시지 ===
        const deadline = BigInt((await ethers.provider.getBlock("latest")).timestamp) + 3600n;
        const domain = {
            name: await stableCoin.name(),
            version: "1",
            chainId: Number((await ethers.provider.getNetwork()).chainId),
            verifyingContract: await stableCoin.getAddress(),
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
        const nonce = await stableCoin.nonces(buyer.address);
        const message = {
            owner: buyer.address,
            spender: await vesting.getAddress(),
            value: estimated,              // ★ buyBox 내부 비교값과 동일
            nonce,
            deadline: Number(deadline),
        };

        const sig = await buyer.signTypedData(domain, types, message);
        const { v, r, s } = ethers.Signature.from(sig);

        await expect(
            vesting.connect(buyer).buyBox(boxCount, refCode, { value: estimated, deadline, v, r, s })
        ).to.emit(vesting, "BoxesPurchased");
    });


    // =============================================================================
    // 자기추천 방지 기능 테스트
    // =============================================================================

    /**
     * @test buyBox: 자기추천 금지
     * @description
     *  - 사용자가 자신의 레퍼럴 코드로 구매를 시도할 때 에러 발생 확인
     *  - 레퍼럴 시스템의 남용 방지 기능 검증
     * 
     * 보안 목적:
     *  - 자기추천을 통한 부당한 이익 취득 방지
     *  - 레퍼럴 시스템의 공정성 보장
     *  - 시스템의 경제적 균형 유지
     */
    it("buyBox: 자기추천 금지", async () => {
        // === 테스트 환경 설정 ===
        const { buyer, vesting, seedReferralFor } = await deployFixture();
        const myCode = await seedReferralFor(buyer);

        const boxCount = 1n;
        // 자기코드는 유효하므로 estimated는 0보다 큼
        const estimated = await vesting.estimatedTotalAmount(boxCount, myCode);
        const pSkip = makePermit(estimated, 0n);

        // === 자기추천 시도 시 에러 발생 확인 ===
        await expect(
            vesting.connect(buyer).buyBox(boxCount, myCode, pSkip)
        ).to.be.revertedWith("self referral");
    });

    // =============================================================================
    // 잘못된 레퍼럴 코드 형식 검증 테스트
    // =============================================================================

    /**
     * @test buyBox: 잘못된 코드 형식(길이/문자셋) revert
     * @description
     *  - 8자리가 아닌 코드, 허용되지 않는 문자 포함 코드
     *  - 레퍼럴 코드의 형식 검증 기능 테스트
     * 
     * 검증 항목:
     *  1. 길이 검증: 정확히 8자리여야 함
     *  2. 문자셋 검증: A-Z, 0-9만 허용
     *  3. 특수문자 포함 시 에러 발생
     * 
     * 보안 목적:
     *  - 잘못된 형식의 코드로 인한 시스템 오류 방지
     *  - 레퍼럴 코드의 일관성과 유효성 보장
     */
    it("buyBox: 잘못된 코드 형식(길이/문자셋) revert", async () => {
        // === 테스트 환경 설정 ===
        const { buyer, vesting } = await deployFixture();
        const pZero = makePermit(0n, 0n);

        // === 1) 길이 오류 테스트 ===
        // 8자리가 아닌 코드로 구매 시도 시 에러 발생
        await expect(vesting.connect(buyer).buyBox(1n, "ABC", pZero))
            .to.be.revertedWith("ref len!=8");

        // === 2) 문자셋 오류 테스트 ===
        // 허용되지 않는 특수문자 포함 코드로 구매 시도 시 에러 발생
        await expect(vesting.connect(buyer).buyBox(1n, "abcd$#12", pZero))
            .to.be.reverted; // 내부에서 "ref invalid char"로 revert
    });
});
