/**
 * @fileoverview
 *  TokenVesting 프로젝트의 공통 유틸리티 및 헬퍼 함수들을 모아놓은 공유 모듈
 *  다양한 스크립트에서 재사용되는 기능들을 중앙화하여 코드 중복을 방지합니다.
 * 
 * 주요 기능:
 *   - 명령행 인수 처리 및 주소 검증
 *   - 배포 정보 파일 로드 및 정규화
 *   - 스마트 컨트랙트 인스턴스 생성 및 연결
 *   - 공통 유틸리티 함수들
 *   - 가스/수수료 로깅 및 집계 유틸
 * 
 * 사용법:
 *   const { pickAddressArg, attachVestingWithEthers, withGasLog, printGasSummary } = require("./_shared");
 * 
 * @author hlibbc
 */

const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { ethers } = hre;

// =============================================================================
// 명령행 인수 처리 함수들
// =============================================================================

/**
 * @notice process.argv에서 i번째 인자를 가져오는 함수
 * @param {number} i - 가져올 인자의 인덱스 (기본값: 0)
 * @returns {string|undefined} 명령행 인수 또는 undefined
 * 
 * 예시: node file.js arg0 arg1 arg2
 *       argv(0) -> "arg0", argv(1) -> "arg1", argv(2) -> "arg2"
 */
function argv(i = 0) {
    return process.argv[2 + i];
}

/**
 * @notice 주소 인자를 파싱하고 체크섬 검증을 수행하는 함수
 * 명령행 인수, USER_ADDRESS 환경변수, ADDRESS 환경변수 순으로 확인
 * @returns {string} 검증된 이더리움 주소 (체크섬 형식)
 * @throws {Error} 주소가 제공되지 않거나 잘못된 형식인 경우
 * 
 * 사용법:
 *   node scripts/previewBuyerClaimable.js 0xabc...
 *   또는 USER_ADDRESS=0xabc... node scripts/...
 */
function pickAddressArg() {
    const raw = argv(0) || process.env.USER_ADDRESS || process.env.ADDRESS;
    if (!raw) {
        throw new Error(
            "사용자 주소가 필요합니다. 예) node scripts/previewBuyerClaimable.js 0xabc... 또는 USER_ADDRESS env 사용"
        );
    }
    try {
        return ethers.getAddress(raw);
    } catch {
        throw new Error(`잘못된 주소 형식입니다: ${raw}`);
    }
}

// =============================================================================
// 배포 정보 로드 및 정규화 함수들
// =============================================================================

/**
 * @notice deployment-info.json 파일을 로드하고 현재 파일 구조에 맞게 정규화하는 함수
 * @param {string} file - 배포 정보 파일 경로 (기본값: output/deployment-info.json)
 * @returns {Object} 정규화된 배포 정보 객체
 * @throws {Error} 파일이 없거나 필수 정보가 누락된 경우
 * 
 * 반환 객체 구조:
 *   - vesting: TokenVesting 컨트랙트 주소
 *   - sbt: BadgeSBT 컨트랙트 주소 (선택)
 *   - stableCoin: StableCoin 컨트랙트 주소 (선택)
 *   - startTs: 시작 타임스탬프 (BigInt)
 *   - forwarder: 메타트랜잭션 포워더 주소 (선택)
 *   - network: 네트워크 정보 (선택)
 *   - raw: 원본 JSON 객체
 */
function loadDeployment(file = path.join(__dirname, "output", "deployment-info.json")) {
    if (!fs.existsSync(file)) {
        throw new Error(`deployment-info.json이 없습니다: ${file}`);
    }
    const obj = JSON.parse(fs.readFileSync(file, "utf8"));
    const c = obj.contracts || {};

    // 현재 JSON 키에 맞게 컨트랙트 주소 추출 (다양한 키 이름 대응)
    const vesting =
        c.vesting ||
        c.tokenVesting ||
        c.TokenVesting;

    const sbt =
        c.sbt ||
        c.badgeSBT ||
        c.BadgeSBT;

    const stableCoin =
        c.stableCoin ||
        c.StableCoin ||
        c.usdt ||
        c.USDT;

    if (!vesting) {
        throw new Error("deployment-info.json에 contracts.tokenVesting 주소가 없습니다.");
    }

    return {
        vesting,
        sbt,
        stableCoin,
        startTs: obj.startTs ? BigInt(obj.startTs) : undefined,
        forwarder: obj.forwarder,
        network: obj.network,
        raw: obj,
    };
}

// =============================================================================
// 스마트 컨트랙트 연결 함수들
// =============================================================================

/**
 * @notice TokenVesting, BadgeSBT, StableCoin 컨트랙트 인스턴스를 생성하고 연결하는 함수
 * @returns {Promise<Object>} 컨트랙트 인스턴스들과 배포 정보를 포함한 객체
 * 
 * 반환 객체 구조:
 *   - d: loadDeployment() 결과
 *   - vesting: TokenVesting 컨트랙트 인스턴스
 *   - sbt: BadgeSBT 컨트랙트 인스턴스 (null일 수 있음)
 *   - stable: StableCoin 컨트랙트 인스턴스 (null일 수 있음)
 *   - ethers: ethers 라이브러리 객체
 */
async function attachContracts() {
    const d = loadDeployment();
    const vesting = await ethers.getContractAt("TokenVesting", d.vesting);
    const sbt = d.sbt ? await ethers.getContractAt("BadgeSBT", d.sbt) : null;
    const stable = d.stableCoin ? await ethers.getContractAt("StableCoin", d.stableCoin) : null;
    return { d, vesting, sbt, stable, ethers };
}

/**
 * @notice 과거 호환성을 위한 래퍼 함수 - vesting만 필요한 스크립트를 위해 제공
 * @returns {Promise<Object>} vesting 컨트랙트 인스턴스와 배포 정보를 포함한 객체
 * 
 * 반환 객체 구조:
 *   - d: loadDeployment() 결과
 *   - vesting: TokenVesting 컨트랙트 인스턴스
 *   - ethers: ethers 라이브러리 객체
 */
async function attachVestingWithEthers() {
    const { d, vesting, ethers } = await attachContracts();
    return { d, vesting, ethers };
}

// =============================================================================
// 가스/수수료 로깅 유틸
// =============================================================================

/**
 * @notice 트랜잭션/영수증에서 가스 사용량, 단가, 총 수수료(wei)를 계산
 * @param {import("ethers").TransactionResponse} tx
 * @param {import("ethers").TransactionReceipt} receipt
 * @returns {{gasUsed: bigint, gasPrice: bigint, feeWei: bigint}}
 */
function gasInfo(tx, receipt) {
    const gasUsed = receipt?.gasUsed ?? 0n;
    const gasPrice =
        receipt?.gasPrice ??
        receipt?.effectiveGasPrice ??
        tx?.gasPrice ??
        tx?.maxFeePerGas ??
        0n;
    const feeWei = gasUsed * gasPrice;
    return { gasUsed, gasPrice, feeWei };
}

/**
 * @notice 한 줄 가스 로그 출력
 * @param {string} prefix
 * @param {import("ethers").TransactionResponse} tx
 * @param {import("ethers").TransactionReceipt} receipt
 */
function logGas(prefix, tx, receipt) {
    const { gasUsed, gasPrice, feeWei } = gasInfo(tx, receipt);
    console.log(
        `${prefix} | gasUsed=${gasUsed} | gasPrice=${ethers.formatUnits(gasPrice, "gwei")} gwei | fee=${ethers.formatEther(feeWei)} ETH`
    );
}

/**
 * @notice 누적 집계 객체에 가스/수수료를 더함 (버킷은 필요 시 자동 생성)
 * @param {Record<string, {gas: bigint, fee: bigint}>} totals
 * @param {string} bucket
 * @param {import("ethers").TransactionResponse} tx
 * @param {import("ethers").TransactionReceipt} receipt
 */
function addGasTotals(totals, bucket, tx, receipt) {
    const gi = gasInfo(tx, receipt);
    totals[bucket] ??= { gas: 0n, fee: 0n };
    totals[bucket].gas += gi.gasUsed;
    totals[bucket].fee += gi.feeWei;
}

/**
 * @notice 가스/수수료 요약 출력 (order 제공 시 해당 순서로, 없으면 키 사전순)
 * @param {Record<string, {gas: bigint, fee: bigint}>} totals
 * @param {string[]=} order
 */
function printGasSummary(totals, order) {
    const entries = order?.length
        ? order.filter(k => totals[k]).map(k => [k, totals[k]])
        : Object.entries(totals).sort(([a], [b]) => a.localeCompare(b));
    const sumFee = entries.reduce((acc, [, v]) => acc + (v?.fee ?? 0n), 0n);

    for (const [k, v] of entries) {
        console.log(`[gas:summary] ${k.padEnd(8)} gas=${v.gas} fee=${ethers.formatEther(v.fee)} ETH`);
    }
    console.log(`[gas:summary] TOTAL     fee=${ethers.formatEther(sumFee)} ETH`);
}

/**
 * @notice 트랜잭션 실행→대기→로깅→누적 집계를 한 번에 수행
 * @param {string} prefix
 * @param {Promise<import("ethers").TransactionResponse>} txPromise
 * @param {Record<string, {gas: bigint, fee: bigint}} totals
 * @param {string} bucket
 * @returns {Promise<import("ethers").TransactionReceipt>}
 */
async function withGasLog(prefix, txPromise, totals, bucket) {
    const tx = await txPromise;
    const rc = await tx.wait();
    logGas(prefix, tx, rc);
    if (totals && bucket) {
        addGasTotals(totals, bucket, tx, rc);
    }
    return rc;
}

// =============================================================================
/* 모듈 내보내기 */
// =============================================================================

module.exports = {
    // 유틸리티
    argv,
    pickAddressArg,

    // 배포 정보/컨트랙트
    loadDeployment,
    attachContracts,
    attachVestingWithEthers,

    // ethers 재내보내기
    ethers,

    // 가스 유틸
    gasInfo,
    logGas,
    addGasTotals,
    printGasSummary,
    withGasLog,
};
