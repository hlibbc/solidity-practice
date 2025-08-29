// scripts/backfillHistories.js
/**
 * @fileoverview
 *  TokenVesting 컨트랙트에 CSV 데이터를 백필하는 스크립트
 *   1) user.csv에서 레퍼럴 코드 정보를 읽어와서 벌크 등록
 *   2) purchase_history.csv에서 구매 이력을 읽어와서 백필
 * 
 * 실행:
 *   npx hardhat run scripts/backfillHistories.js --network <net>
 * 
 * 환경변수(../.env):
 *   OWNER_KEY=<개인키>
 *   PROVIDER_URL=<RPC URL> (선택, 기본값: http://127.0.0.1:8545)
 * 
 * @author hlibbc
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { ethers } = hre;

// =============================================================================
// 공통 유틸리티 함수들
// =============================================================================

/**
 * @notice 지정된 시간만큼 대기하는 함수
 * @param {number} ms - 대기할 시간 (밀리초)
 * @returns {Promise} 대기 완료 Promise
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @notice 네트워크에 따라 필요시 대기하는 함수
 * 로컬 네트워크에서는 트랜잭션 간 1초 대기
 */
async function waitIfNeeded() {
    if (["localhost", "hardhat", "development"].includes(hre.network.name)) {
        await sleep(1000);
    }
}

/**
 * @notice 파일을 읽어오는 함수 (파일이 없으면 에러 발생)
 * @param {string} p - 파일 경로
 * @returns {string} 파일 내용
 */
function mustRead(p) {
    if (!fs.existsSync(p)) throw new Error(`CSV not found: ${p}`);
    return fs.readFileSync(p, "utf8");
}

// =============================================================================
// 데이터 검증 및 변환 함수들 (테스트 코드와 동일한 규칙)
// =============================================================================

/**
 * @notice 레퍼럴 코드를 정규화하고 검증
 * @param {string} code - 레퍼럴 코드
 * @returns {string} 정규화된 레퍼럴 코드 (빈 문자열이면 "")
 */
function normCodeMaybeEmpty(code) {
    const c = String(code || "").trim();
    if (!c) return "";
    const up = c.toUpperCase();
    if (!/^[A-Z0-9]{8}$/.test(up)) throw new Error(`Invalid referral code: ${code}`);
    return up;
}

/**
 * @notice 박스 개수를 BigInt로 변환
 * @param {string} v - 박스 개수 문자열
 * @returns {bigint} 박스 개수
 */
function parseBoxCount(v) {
    const s = String(v).trim();
    if (!/^\d+$/.test(s)) throw new Error(`Invalid amount: ${v}`);
    return BigInt(s);
}

/**
 * @notice USDT 6자리 소수점을 BigInt로 변환 (예: 300.123456 -> 300123456)
 * @param {string} v - USDT 금액 문자열
 * @returns {bigint} USDT 금액 (6자리 소수점)
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
 * @notice 시간 문자열을 epoch 초 단위로 변환
 * @param {string} v - 시간 문자열 (ISO 형식, epoch 초, epoch 밀리초 등)
 * @returns {bigint} epoch 초
 */
function parseEpochSec(v) {
    const t = String(v).trim();
    if (/^\d{10}$/.test(t)) return BigInt(t);                    // epoch 초
    if (/^\d{13}$/.test(t)) return BigInt(t) / 1000n;            // epoch 밀리초
    
    let iso = t;
    if (!/[zZ]|[+\-]\d{2}:?\d{2}/.test(t)) iso = t.replace(" ", "T") + "Z"; // TZ없으면 UTC로 가정
    const ms = Date.parse(iso);
    if (Number.isNaN(ms)) throw new Error(`Bad datetime: ${v}`);
    return BigInt(Math.floor(ms / 1000));
}

// =============================================================================
// CSV 파싱 및 검증 함수들
// =============================================================================

/**
 * @notice user.csv 파일을 파싱하여 레퍼럴 코드 정보를 추출
 * 권장 헤더: wallet_address, referral_code (무헤더면 [wallet, code])
 * @param {string} csvText - CSV 파일 내용
 * @returns {Array<{wallet: string, code: string}>} 지갑 주소와 레퍼럴 코드 배열
 */
function parseUsersCsv(csvText) {
    const lines = csvText.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (!lines.length) return [];
    
    // 헤더 인덱스 찾기
    const header = lines[0].split(",").map(s => s.trim().toLowerCase());
    let start = 0, w = 0, c = 1;
    const hasHeader = ["wallet_address", "referral_code"].some(h => header.includes(h));
    
    if (hasHeader) {
        w = header.findIndex(h => ["wallet_address"].includes(h));
        c = header.findIndex(h => ["referral_code"].includes(h));
        if (w < 0 || c < 0) throw new Error("user.csv header not recognized (wallet_address/referral_code)");
        start = 1;
    }
    
    // 데이터 행 파싱
    const rows = [];
    for (let i = start; i < lines.length; i++) {
        const cols = lines[i].split(",").map(s => s.trim());
        const wallet = cols[w], code = cols[c];
        if (wallet && code) rows.push({ wallet, code });
    }
    return rows;
}

/**
 * @notice purchase_history.csv 파일을 파싱하여 구매 정보를 추출
 * 권장 헤더: wallet_address, referral, amount, avg_price, updated_at
 * 무헤더면 [wallet, referral, amount, price, time]
 * @param {string} csvText - CSV 파일 내용
 * @returns {Array<{wallet: string, ref: string, amount: string, price: string, time: string}>} 구매 정보 배열
 */
function parsePurchasesCsv(csvText) {
    const lines = csvText.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (!lines.length) return [];
    
    // 헤더 인덱스 찾기
    const header = lines[0].split(",").map(s => s.trim().toLowerCase());
    let start = 0;
    const idx = {
        wallet: header.findIndex(h => ["wallet_address"].includes(h)),
        ref:    header.findIndex(h => ["referral"].includes(h)),
        amount: header.findIndex(h => ["amount"].includes(h)),
        price:  header.findIndex(h => ["avg_price"].includes(h)),
        time:   header.findIndex(h => ["updated_at"].includes(h)),
    };
    
    const hasHeader = Object.values(idx).some(i => i !== -1);
    if (hasHeader) {
        if (idx.wallet < 0 || idx.amount < 0 || idx.price < 0 || idx.time < 0) {
            throw new Error("purchase_history.csv header not recognized (wallet_address/amount/avg_price/updated_at)");
        }
        start = 1;
    } else {
        // 헤더가 없는 경우 기본 인덱스 사용
        idx.wallet = 0; idx.ref = 1; idx.amount = 2; idx.price = 3; idx.time = 4;
    }
    
    // 데이터 행 파싱
    const rows = [];
    for (let i = start; i < lines.length; i++) {
        const cols = lines[i].split(",").map(s => s.trim());
        const g = k => (idx[k] >= 0 && idx[k] < cols.length) ? cols[idx[k]] : "";
        const wallet = g("wallet"), ref = g("ref"), amount = g("amount"), price = g("price"), time = g("time");
        if (wallet && amount && price && time) rows.push({ wallet, ref, amount, price, time });
    }
    return rows;
}

// =============================================================================
// 메인 함수
// =============================================================================

/**
 * @notice 메인 함수 - CSV 데이터를 TokenVesting 컨트랙트에 백필
 */
async function main() {
    console.log("🚀 backfillHistories 시작");
    
    // === 환경변수 및 네트워크 설정 ===
    const ownerKey = process.env.OWNER_KEY;
    const providerUrl = process.env.PROVIDER_URL || "http://127.0.0.1:8545";
    if (!ownerKey) throw new Error("❌ .env의 OWNER_KEY가 필요합니다.");

    const provider = new ethers.JsonRpcProvider(providerUrl);
    const wallet = new ethers.Wallet(ownerKey, provider);
    console.log("🌐 네트워크:", hre.network.name);
    console.log("👤 실행 계정:", wallet.address);

    // === 배포 정보 로드 ===
    const outPath = path.join(__dirname, "output", "deployment-info.json");
    if (!fs.existsSync(outPath)) throw new Error(`❌ 파일 없음: ${outPath}`);
    const info = JSON.parse(fs.readFileSync(outPath, "utf8"));
    
    // 다양한 배포 정보 형식에 대응
    const vestingAddr =
        info.tokenVesting || info.contracts?.tokenVesting || info.contracts?.vesting || info.vesting;
    if (!vestingAddr) throw new Error("❌ deployment-info.json에 TokenVesting 주소가 없습니다.");

    const vesting = await ethers.getContractAt("TokenVesting", vestingAddr, wallet);
    console.log("🔗 TokenVesting:", vestingAddr);

    // === CSV 파일 로드 ===
    const userCsvPath = path.join(__dirname, "data", "user.csv");
    const purchCsvPath = path.join(__dirname, "data", "purchase_history.csv");
    const userRows = parseUsersCsv(mustRead(userCsvPath));
    const purchRows = parsePurchasesCsv(mustRead(purchCsvPath));
    console.log(`📦 user.csv rows: ${userRows.length}`);
    console.log(`📦 purchase_history.csv rows: ${purchRows.length}`);

    // === 1단계: 레퍼럴 코드 세팅 (bulk, overwrite=true 권장) ===
    if (userRows.length) {
        console.log("\n1️⃣ setReferralCodesBulk...");
        const BATCH = 150;  // 한 번에 처리할 배치 크기
        let done = 0;
        
        while (done < userRows.length) {
            const slice = userRows.slice(done, done + BATCH);
            const addrs = slice.map(r => ethers.getAddress(r.wallet));
            const codes = slice.map(r => {
                const n = normCodeMaybeEmpty(r.code);
                if (!n) throw new Error(`Empty code for ${r.wallet}`);
                return n;
            });
            
            // 벌크로 레퍼럴 코드 등록
            const tx = await vesting.setReferralCodesBulk(addrs, codes, true);
            await tx.wait();
            console.log(`  • ${done}..${done + slice.length - 1} ok (tx: ${tx.hash})`);
            done += slice.length;
            await waitIfNeeded();
        }
        console.log("✅ referral codes done");
    } else {
        console.log("\n1️⃣ setReferralCodesBulk: rows=0 (skip)");
    }

    // === 2단계: 구매 이력 백필 ===
    // paidUnits = amount * avg_price(6dec), creditBuyback = true
    if (purchRows.length) {
        console.log("\n2️⃣ backfillPurchaseAt...");
        let ok = 0, fail = 0;
        
        for (let i = 0; i < purchRows.length; i++) {
            const r = purchRows[i];
            try {
                const buyer = ethers.getAddress(r.wallet);
                const refCodeStr = normCodeMaybeEmpty(r.ref);   // "" 허용 (레퍼럴 없음)
                const boxCount = parseBoxCount(r.amount);
                const paidUnits = parseUsdt6(r.price) * boxCount;  // USDT 6자리 소수점
                const purchaseTs = parseEpochSec(r.time);

                // 구매 기록 백필
                const tx = await vesting.backfillPurchaseAt(
                    buyer,
                    refCodeStr,
                    boxCount,
                    purchaseTs,
                    paidUnits,
                    true // creditBuyback
                );
                await tx.wait();
                ok++;
                
                // 50개마다 진행 상황 출력
                if (ok % 50 === 0) console.log(`  • 진행: ${ok} 성공 / ${fail} 실패`);
                await waitIfNeeded();
            } catch (e) {
                fail++;
                console.warn(`  × row#${i} 실패:`, e.shortMessage || e.message || e);
            }
        }
        console.log(`✅ backfill done — 성공 ${ok} / 실패 ${fail}`);
    } else {
        console.log("\n2️⃣ backfillPurchaseAt: rows=0 (skip)");
    }

    console.log("\n🎉 backfillHistories 완료!");
}

// =============================================================================
// 스크립트 실행 및 에러 처리
// =============================================================================

main().then(() => process.exit(0)).catch((err) => {
    console.error("❌ 스크립트 오류:", err);
    process.exit(1);
});
