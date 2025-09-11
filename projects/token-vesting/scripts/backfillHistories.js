/* eslint-disable no-console */
/**
 * @fileoverview
 *  TokenVesting 컨트랙트의 히스토리 백필 스크립트 (구매 + 박스 전송)
 * @description
 *   1) user.csv로 레퍼럴 코드 선등록
 *   2) purchase_history.csv → backfillPurchaseBulkAt (10개씩 벌크)
 *   3) sendbox_history.csv → backfillSendBoxBulkAt (10개씩 벌크)
 *   4) (옵션) .env의 VEST_EPOCH(= query_ts)까지만 syncLimitDay 1회
 *
 * 실행:
 *   npx hardhat run scripts/adhoc/backfillHistory.js --network <net>
 *
 * 주의:
 *  - 동일 CSV를 재주입하면 중복 반영됩니다(컨트랙트가 중복 방어 안함)
 *  - 각 CSV는 내부적으로 **시간 오름차순 정렬 권장** (같은 user의 effDay가 역전되면 컨트랙트에서 revert)
 *  - 구매 → 전송 → (마지막) sync 순서를 지키십시오
 *
 * 변경사항:
 *  - 단건 함수(backfillPurchaseAt, backfillSendBoxAt) 대신 벌크 함수 사용:
 *      - backfillPurchaseBulkAt(BackfillPurchase[]), backfillSendBoxBulkAt(BackfillSendBox[])
 *  - 배치 크기: 10개 (컨트랙트 MAX_BACKFILL_BULK=10에 맞춤)
 *  - 실패 시 같은 배치를 **한 번 재시도** (더 복잡한 반 분할 재시도 로직 제거)
 *
 * @author hlibbc
 */
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { ethers } = hre;
const Shared = require("./_shared"); // 가스 유틸(withGasLog 등) 사용

// ── .env 로드 (scripts/adhoc 기준 상위에 .env가 있다면 경로 맞춰 주세요)
require("dotenv").config({ path: path.join(__dirname, "../.env") });

// ──────────────────────────────────────────────────────────────────────────────
// 공통 유틸
// ──────────────────────────────────────────────────────────────────────────────
/**
 * @description 파일 존재를 보장하며 내용을 UTF-8로 읽습니다
 * @param {string} p - 읽을 파일의 절대/상대 경로
 * @returns {string} 파일 텍스트 내용
 * @throws {Error} 파일이 존재하지 않으면 에러를 발생시킵니다
 */
function mustRead(p) {
    if (!fs.existsSync(p)) throw new Error(`File not found: ${p}`);
    return fs.readFileSync(p, "utf8");
}

/**
 * @description 배포 산출물(`scripts/output/deployment-info.json`)을 로드합니다
 * @returns {{contracts?: {tokenVesting?: string}, startTs?: string}} 배포 정보 객체
 * @throws {Error} 파일이 없거나 JSON 파싱이 실패하면 에러를 발생시킵니다
 */
function loadDeploymentInfo() {
    const p = path.join(__dirname, "./output/deployment-info.json");
    if (!fs.existsSync(p)) {
        throw new Error(`deployment-info.json not found: ${p}\n(먼저 deployContracts.js 실행)`);
    }
    return JSON.parse(fs.readFileSync(p, "utf8"));
}

/**
 * @description 레퍼럴 코드를 정규화합니다(대문자/공백제거). 빈 값은 허용합니다.
 * @param {string} code - 원본 레퍼럴 코드
 * @returns {string} 정규화된 코드 또는 빈 문자열
 * @throws {Error} 비어있지 않은데 형식이 8자리 영숫자가 아니면 에러
 */
function normCodeMaybeEmpty(code) {
    const c = String(code || "").trim();
    if (!c) return "";
    const up = c.toUpperCase();
    if (!/^[A-Z0-9]{8}$/.test(up)) throw new Error(`Invalid referral code: ${code}`);
    return up;
}

/**
 * @description 박스 수량을 정수로 검증 후 BigInt로 변환합니다
 * @param {string|number} v - 박스 수량
 * @returns {bigint} BigInt 수량
 */
function parseBoxCount(v) {
    const s = String(v).trim();
    if (!/^\d+$/.test(s)) throw new Error(`Invalid amount: ${v}`);
    return BigInt(s);
}

/**
 * @description USDT 값을 6자리 소수 단위(BigInt)로 변환합니다
 * @param {string|number} v - 예: "300" | "300.5" | 300
 * @returns {bigint} 6자리 소수 기준 금액
 */
function parseUsdt6(v) {
    const s = String(v).trim();
    if (/^\d+$/.test(s)) return BigInt(s) * 10n ** 6n;
    const [L, R = ""] = s.split(".");
    const left = (L || "0").replace(/[^\d]/g, "");
    const right = (R.replace(/[^\d]/g, "") + "000000").slice(0, 6);
    return BigInt(left || "0") * 10n ** 6n + BigInt(right || "0");
}

/**
 * @description 다양한 시간 표현을 epoch 초(BigInt)로 변환합니다
 * @param {string|number} v - 10/13자리 epoch 또는 ISO 문자열
 * @returns {bigint} epoch seconds
 */
function parseEpochSec(v) {
    const t = String(v).trim();

    // 10자리(초), 13자리(밀리초) epoch 그대로 처리
    if (/^\d{10}$/.test(t)) return BigInt(t);
    if (/^\d{13}$/.test(t)) return BigInt(t) / 1000n;

    let iso = t;

    // "YYYY-MM-DD H:mm[:ss]" → "YYYY-MM-DDTHH:mm[:ss]Z" 로 변환
    const m = t.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (m) {
        const [_, date, h, mm, ssRaw] = m;
        const hh = h.padStart(2, "0");
        const ss = (ssRaw || "00").padStart(2, "0");
        iso = `${date}T${hh}:${mm}:${ss}Z`;
    } else if (!/[zZ]|[+\-]\d{2}:?\d{2}/.test(t)) {
        iso = t.replace(" ", "T") + "Z";
    }

    const ms = Date.parse(iso);
    if (Number.isNaN(ms)) throw new Error(`Bad datetime: ${v}`);
    return BigInt(Math.floor(ms / 1000));
}

/**
 * @description 배열을 고정 크기(chunkSize)로 분할합니다
 * @param {Array<T>} arr
 * @param {number} chunkSize
 * @returns {Array<Array<T>>}
 */
function chunk(arr, chunkSize) {
    const out = [];
    for (let i = 0; i < arr.length; i += chunkSize) {
        out.push(arr.slice(i, i + chunkSize));
    }
    return out;
}

/**
 * @description tx 팩토리 함수를 받아 1회 재시도까지 수행합니다
 * @param {() => Promise<any>} txFactory - 호출 시점을 늦추기 위한 팩토리
 * @param {string} label - 로그 표기용
 * @param {object} totals - 가스 집계 버킷
 * @param {string} bucket - 집계 키(referral|purchase|send|sync)
 */
async function withRetryOnce(txFactory, label, totals, bucket) {
    try {
        await Shared.withGasLog(label, txFactory(), totals, bucket);
    } catch (e) {
        console.warn(`${label} failed (1st). retrying...`, e?.reason || e?.message || String(e));
        // 간단한 짧은 대기(옵션)
        await new Promise(r => setTimeout(r, 300));
        await Shared.withGasLog(label + " [retry]", txFactory(), totals, bucket);
    }
}

// ──────────────────────────────────────────────────────────────────────────────
/**
 * @description user.csv 파싱
 * @example 헤더: wallet_address, referral_code
 */
function parseUsersCsv(csvText) {
    const lines = csvText.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (!lines.length) return [];
    const header = lines[0].split(",").map(s => s.trim().toLowerCase());
    let start = 0, w = 0, c = 1;
    const hasHeader = ["wallet_address", "referral_code"].some(h => header.includes(h));
    if (hasHeader) {
        w = header.findIndex(h => h === "wallet_address");
        c = header.findIndex(h => h === "referral_code");
        if (w < 0 || c < 0) throw new Error("user.csv header not recognized");
        start = 1;
    }
    const rows = [];
    for (let i = start; i < lines.length; i++) {
        const cols = lines[i].split(",").map(s => s.trim());
        const wallet = cols[w], code = cols[c];
        if (wallet && code) rows.push({ wallet, code });
    }
    return rows;
}

/**
 * @description purchase_history.csv 파싱
 * @example 컬럼: wallet_address, referral_code?, amount, updated_at, price?(선택)
 * price 컬럼이 없으면 스크립트 상수 사용
 */
function parsePurchasesCsv(csvText) {
    const lines = csvText.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (!lines.length) return [];
    const header = lines[0].split(",").map(s => s.trim().toLowerCase());
    let start = 0;
    const idx = {
        wallet: header.findIndex(h => h === "wallet_address"),
        ref: header.findIndex(h => h === "referral" || h === "referral_code"),
        amount: header.findIndex(h => h === "amount"),
        time: header.findIndex(h => h === "updated_at"),
        price: header.findIndex(h => h === "price"),
    };
    const hasHeader = Object.values(idx).some(i => i !== -1);
    if (hasHeader) {
        if (idx.wallet < 0 || idx.time < 0 || idx.amount < 0) {
            throw new Error("purchase_history.csv header not recognized");
        }
        start = 1;
    } else {
        idx.wallet = 0; idx.ref = 1; idx.amount = 2; idx.time = 4; idx.price = -1;
    }
    const rows = [];
    for (let i = start; i < lines.length; i++) {
        const cols = lines[i].split(",").map(s => s.trim());
        const g = k => (idx[k] >= 0 && idx[k] < cols.length) ? cols[idx[k]] : "";
        const wallet = g("wallet"), ref = g("ref"), amount = g("amount"), time = g("time");
        const price = g("price") || "300";
        if (wallet && amount && time) rows.push({ wallet, ref, amount, price, time });
    }
    return rows;
}

/**
 * @description sendbox_history.csv 파싱
 * @example 컬럼: from_wallet_address, to_wallet_address, amount, updated_at
 */
function parseSendboxCsv(csvText) {
    const lines = csvText.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (!lines.length) return [];
    const header = lines[0].split(",").map(s => s.trim().toLowerCase());
    let start = 0;
    const idx = {
        from: header.findIndex(h => h === "from_wallet_address"),
        to: header.findIndex(h => h === "to_wallet_address"),
        amount: header.findIndex(h => h === "amount"),
        time: header.findIndex(h => h === "updated_at"),
    };
    const hasHeader = Object.values(idx).some(i => i !== -1);
    if (hasHeader) {
        if (idx.from < 0 || idx.to < 0 || idx.amount < 0 || idx.time < 0) {
            throw new Error("sendbox_history.csv header not recognized");
        }
        start = 1;
    } else {
        throw new Error("sendbox_history.csv must have header");
    }
    const rows = [];
    for (let i = start; i < lines.length; i++) {
        const cols = lines[i].split(",").map(s => s.trim());
        const from = cols[idx.from], to = cols[idx.to], amount = cols[idx.amount], time = cols[idx.time];
        if (from && to && amount && time) rows.push({ from, to, amount, time });
    }
    return rows;
}

// ──────────────────────────────────────────────────────────────────────────────
// 메인
// ─────────────────────────────────────────────────────────────────────────────-
/**
 * @description TokenVesting 히스토리 백필 메인 루틴
 * 절차: 1) 레퍼럴 선등록 → 2) 구매 백필(벌크) → 3) 박스 전송 백필(벌크) → 4) (옵션) 동기화
 * 주의: 동일 CSV 재주입 시 중복 반영. CSV는 시간 오름차순 정렬 권장.
 */
async function main() {
    // 배포정보 & 컨트랙트
    const info = loadDeploymentInfo();
    const vestingAddr = info?.contracts?.tokenVesting;
    if (!vestingAddr) throw new Error("tokenVesting address missing in deployment-info.json");

    // 가스 집계 버킷
    const totals = {}; // { referral: {gas,fee}, purchase: {...}, send: {...}, sync: {...} }

    let owner;
    if (hre.network.name !== "development") {
        const ownerKey = process.env.OWNER_KEY;
        if (!ownerKey) {
            throw new Error("❌ .env에 OWNER_KEY를 설정하세요.");
        }
        const providerUrl = process.env.PROVIDER_URL || "http://localhost:8545";
        const provider = new ethers.JsonRpcProvider(providerUrl);
        owner = new ethers.Wallet(ownerKey, provider);
    } else {
        owner = (await ethers.getSigners())[0];
    }

    const vesting = await ethers.getContractAt("TokenVesting", vestingAddr, owner);

    // 1) 레퍼럴 선등록
    const userCsvPath = path.join(__dirname, "./data/user.csv");
    if (fs.existsSync(userCsvPath)) {
        const userRows = parseUsersCsv(mustRead(userCsvPath));
        const users = userRows.map(r => ethers.getAddress(r.wallet));
        const codes = userRows.map(r => normCodeMaybeEmpty(r.code));
        await Shared.withGasLog(
            `[referral] setReferralCodesBulk x${users.length}`,
            vesting.connect(owner).setReferralCodesBulk(users, codes, true),
            totals, "referral"
        );
    } else {
        console.log("[referral] skipped: user.csv not found");
    }

    // 2) 구매 내역 백필 (purchase_history.csv → bulk, 10개씩)
    const purchaseCsvPath = path.join(__dirname, "./data/purchase_history.csv");
    if (fs.existsSync(purchaseCsvPath)) {
        // CSV 파싱 후 시간 오름차순 정렬 권장 (같은 buyer가 섞여 들어올 때 effDay 역전 방지)
        const rows = parsePurchasesCsv(mustRead(purchaseCsvPath))
            .sort((a, b) => Number(parseEpochSec(a.time) - parseEpochSec(b.time)));

        console.log(`[purchase] ${rows.length} rows (sorted asc by time)`);
        const batches = chunk(rows, 10);
        let ok = 0, skipped = 0;

        for (let bi = 0; bi < batches.length; bi++) {
            const batchRows = batches[bi];
            try {
                // 컨트랙트 Struct 배열 변환
                const items = batchRows.map((row) => {
                    const buyer = ethers.getAddress(row.wallet);
                    const refCodeStr = normCodeMaybeEmpty(row.ref);
                    const boxCount = parseBoxCount(row.amount);
                    const purchaseTs = parseEpochSec(row.time);
                    const paidUnits = boxCount * parseUsdt6(row.price || "300");
                    if (boxCount === 0n) throw new Error("boxCount=0");
                    return {
                        buyer,
                        refCodeStr,
                        boxCount,
                        purchaseTs,
                        paidUnits
                    };
                });

                await withRetryOnce(
                    () => vesting.connect(owner).backfillPurchaseBulkAt(items),
                    `[purchase] bulk ${bi + 1}/${batches.length} (size=${items.length})`,
                    totals,
                    "purchase"
                );
                ok += items.length;
            } catch (e) {
                console.warn(`[purchase skip] bulk ${bi + 1}/${batches.length}`, "\n reason:", e?.reason || e?.message || String(e));
                skipped += batchRows.length;
            }

            if ((bi + 1) % 10 === 0) {
                console.log(`[purchase] progress ${bi + 1}/${batches.length} (ok=${ok}, skipped=${skipped})`);
            }
        }

        console.log(`[purchase] success=${ok}, skipped=${skipped}`);
    } else {
        console.log("[purchase] skipped: purchase_history.csv not found");
    }

    // 3) 전송 내역 백필 (sendbox_history.csv → bulk, 10개씩)
    const sendboxCsvPath = path.join(__dirname, "./data/sendbox_history.csv");
    if (fs.existsSync(sendboxCsvPath)) {
        // CSV 파싱 후 시간 오름차순 정렬 권장 (같은 from의 effDay 역전 방지)
        const rows = parseSendboxCsv(mustRead(sendboxCsvPath))
            .sort((a, b) => Number(parseEpochSec(a.time) - parseEpochSec(b.time)));

        console.log(`[sendbox] ${rows.length} rows (sorted asc by time)`);
        const batches = chunk(rows, 10);
        let ok = 0, skipped = 0;

        for (let bi = 0; bi < batches.length; bi++) {
            const batchRows = batches[bi];
            try {
                const items = batchRows.map((row) => {
                    const from = ethers.getAddress(row.from);
                    const to = ethers.getAddress(row.to);
                    const boxCount = parseBoxCount(row.amount);
                    const transferTs = parseEpochSec(row.time);
                    if (boxCount === 0n) throw new Error("boxCount=0");
                    return {
                        from,
                        to,
                        boxCount,
                        transferTs
                    };
                });

                await withRetryOnce(
                    () => vesting.connect(owner).backfillSendBoxBulkAt(items),
                    `[sendbox] bulk ${bi + 1}/${batches.length} (size=${items.length})`,
                    totals,
                    "send"
                );
                ok += items.length;
            } catch (e) {
                console.warn(`[sendbox skip] bulk ${bi + 1}/${batches.length}`, "\n reason:", e?.reason || e?.message || String(e));
                skipped += batchRows.length;
            }

            if ((bi + 1) % 10 === 0) {
                console.log(`[sendbox] progress ${bi + 1}/${batches.length} (ok=${ok}, skipped=${skipped})`);
            }
        }

        console.log(`[sendbox] success=${ok}, skipped=${skipped}`);
    } else {
        console.log("[sendbox] skipped: sendbox_history.csv not found");
    }

    // 4) (옵션) VEST_EPOCH까지 sync 1회
    const queryTsStr = process.env.VEST_EPOCH;
    if (!queryTsStr) {
        console.log("[sync] skipped: no VEST_EPOCH in .env");
        Shared.printGasSummary(totals, ["referral", "purchase", "send", "sync"]);
        console.log("✅ backfillHistory finished.");
        return;
    }

    const START_TS = BigInt(info.startTs);
    const DAY = 86400n;
    const QUERY_TS = BigInt(queryTsStr);
    const dTarget = QUERY_TS <= START_TS ? 0n : (QUERY_TS - START_TS) / DAY;

    try {
        const lastSyncedDay = BigInt(await vesting.lastSyncedDay());
        const need = dTarget > lastSyncedDay ? (dTarget - lastSyncedDay) : 0n;
        if (need > 0n) {
            await Shared.withGasLog(
                `[sync] syncLimitDay(${need.toString()})`,
                vesting.syncLimitDay(need),
                totals, "sync"
            );
            console.log(`[sync] done (lastSyncedDay: ${lastSyncedDay.toString()} -> ${dTarget.toString()})`);
        } else {
            console.log(`[sync] up-to-date (lastSyncedDay=${lastSyncedDay.toString()} >= dTarget=${dTarget.toString()})`);
        }
    } catch (e) {
        console.warn("[sync] failed:", e?.reason || e?.message || String(e));
    }

    // 가스 요약 출력
    Shared.printGasSummary(totals, ["referral", "purchase", "send", "sync"]);
    console.log(`[UTC ${new Date().toISOString()}] ✅ backfillHistory finished.`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
