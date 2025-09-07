/* eslint-disable no-console */
/**
 * @fileoverview
 *  TokenVesting 동기화 전용 스크립트
 * @description
 *   1) deployment-info.json에서 컨트랙트 주소/시작시각 로드
 *   2) lastSyncedDay 읽기
 *   3) 현재 시각(now) 기준 목표 일(dTarget) 계산
 *   4) (dTarget - lastSyncedDay)을 7일 단위로 분할하여 syncLimitDay 반복 실행
 *      - 3일 지남  → syncLimitDay(3)
 *      - 12일 지남 → syncLimitDay(7), syncLimitDay(5)
 *      - 15일 지남 → syncLimitDay(7), syncLimitDay(7), syncLimitDay(1)
 *
 * 실행:
 *   npx hardhat run scripts/adhoc/syncVesting.js --network <net>
 *
 * 환경변수(.env):
 *   OWNER_KEY     : 배포/운영 지갑 프라이빗키 (필수)
 *   PROVIDER_URL  : RPC URL (선택, 기본 http://localhost:8545)
 *
 * 주의:
 *  - 컨트랙트가 scheduleInitialized=false면 sync가 revert 됩니다.
 *  - 네트워크 가스 상태에 따라 한 번에 7일도 실패할 수 있으니, 필요 시 값을 조절하세요.
 *
 * @author hlibbc
 */
const path = require("path");
const hre = require("hardhat");
const { ethers } = hre;
const Shared = require("./_shared");

// ── .env 로드 (scripts/adhoc 기준 상위에 .env가 있다면 경로 맞춰 주세요)
require("dotenv").config({ path: path.join(__dirname, "../.env") });

// ──────────────────────────────────────────────────────────────────────────────
// 유틸
// ──────────────────────────────────────────────────────────────────────────────
/**
 * @description 배포 산출물(`scripts/adhoc/output/deployment-info.json`)을 로드합니다.
 * @returns {{contracts?: {tokenVesting?: string}, startTs?: string}}
 */
function loadDeploymentInfo() {
    const fs = require("fs");
    const p = path.join(__dirname, "./output/deployment-info.json");
    if (!fs.existsSync(p)) {
        throw new Error(`deployment-info.json not found: ${p}\n(먼저 deployContracts.js 실행)`);
    }
    return JSON.parse(fs.readFileSync(p, "utf8"));
}

/**
 * @description n(남은 일수)을 7일 단위로 분할하는 제너레이터
 * @param {bigint} total
 */
function* sevenDayChunks(total) {
    const SEVEN = 7n;
    let remain = total;
    while (remain > 0n) {
        const take = remain > SEVEN ? SEVEN : remain;
        yield take;
        remain -= take;
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// 메인
// ──────────────────────────────────────────────────────────────────────────────
async function main() {
    // 1) 배포정보 & 컨트랙트
    const info = loadDeploymentInfo();
    const vestingAddr = info?.contracts?.tokenVesting;
    if (!vestingAddr) throw new Error("tokenVesting address missing in deployment-info.json");
    if (!info?.startTs) throw new Error("startTs missing in deployment-info.json");

    // 가스 요약 집계
    const totals = {}; // { sync: {gas, fee} }

    // 지갑/프로바이더
    let owner;
    if (hre.network.name !== "development") {
        const ownerKey = process.env.OWNER_KEY;
        if (!ownerKey) throw new Error("❌ .env에 OWNER_KEY를 설정하세요.");
        const providerUrl = process.env.PROVIDER_URL || "http://localhost:8545";
        const provider = new ethers.JsonRpcProvider(providerUrl);
        owner = new ethers.Wallet(ownerKey, provider);
    } else {
        owner = (await ethers.getSigners())[0];
    }

    const vesting = await ethers.getContractAt("TokenVesting", vestingAddr, owner);

    // 2) lastSyncedDay 읽기
    const lastSyncedDay = BigInt(await vesting.lastSyncedDay()); // 확정된 '총 일수'
    console.log(`[sync] lastSyncedDay = ${lastSyncedDay.toString()}`);

    // 3) 현재 시각(now) 기준 목표 일(dTarget) 계산
    const START_TS = BigInt(info.startTs);
    const DAY = 86400n;
    const NOW_SEC = BigInt(Math.floor(Date.now() / 1000));
    const dTarget = NOW_SEC <= START_TS ? 0n : (NOW_SEC - START_TS) / DAY;
    console.log(`[sync] dTarget (by now) = ${dTarget.toString()}`);

    // 4) 필요 일수 산출 및 7일 단위로 syncLimitDay 수행
    const need = dTarget > lastSyncedDay ? (dTarget - lastSyncedDay) : 0n;
    if (need === 0n) {
        console.log(`[sync] up-to-date (lastSyncedDay=${lastSyncedDay.toString()} >= dTarget=${dTarget.toString()})`);
        Shared.printGasSummary(totals, ["sync"]);
        console.log("✅ syncVesting finished.");
        return;
    }

    console.log(`[sync] need = ${need.toString()} day(s). Executing in chunks of 7...`);

    let progressed = 0n;
    for (const days of sevenDayChunks(need)) {
        await Shared.withGasLog(
            `[sync] syncLimitDay(${days.toString()})`,
            vesting.syncLimitDay(days),
            totals, "sync"
        );
        progressed += days;
        console.log(`[sync] progressed +${days.toString()} (total ${progressed.toString()}/${need.toString()})`);
    }

    // 완료 후 상태 확인(선택)
    try {
        const after = BigInt(await vesting.lastSyncedDay());
        console.log(`[sync] done (lastSyncedDay: ${lastSyncedDay.toString()} -> ${after.toString()})`);
    } catch {
        // 조회 실패해도 전체 흐름에는 영향 없음
    }

    Shared.printGasSummary(totals, ["sync"]);
    console.log("✅ syncVesting finished.");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
