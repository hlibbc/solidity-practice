// test/vesting.backfill.fromcsv.test.js
/**
 * @fileoverview
 *  CSV 파일을 통한 구매 이력 백필 테스트
 * @description
 *  - user.csv에서 사용자 정보와 레퍼럴 코드를 읽어와서 설정
 *  - purchase_history.csv에서 구매 이력을 읽어와서 backfillPurchaseBulkAt으로 벌크 백필
 *  - 백필된 데이터가 on-chain 상태와 일치하는지 검증
 *
 * @author hlibbc
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
const { deployFixture } = require("./helpers/vestingFixture");

// =============================================================================
// CSV 유틸리티 함수들
// =============================================================================
function findCsvText(candidates) {
    for (const p of candidates) {
        if (!p) continue;
        if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
    }
    throw new Error(
        "CSV 파일을 찾을 수 없습니다.\n" +
        candidates.filter(Boolean).join("\n")
    );
}

function parseUsersCsv(csvText) {
    const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return [];

    const firstCols = lines[0].split(",").map(s => s.trim());
    const lower = firstCols.map(s => s.toLowerCase());
    let startIdx = 0, walletIdx = 0, codeIdx = 1;

    const hasHeader = ["wallet_address","referral_code"].some(h => lower.includes(h));

    if (hasHeader) {
        walletIdx = lower.findIndex(h => ["wallet_address"].includes(h));
        codeIdx   = lower.findIndex(h => ["referral_code"].includes(h));
        if (walletIdx === -1 || codeIdx === -1) throw new Error("user.csv 헤더를 인식하지 못했습니다.");
        startIdx = 1;
    }

    const rows = [];
    for (let i = startIdx; i < lines.length; i++) {
        const cols = lines[i].split(",").map(s => s.trim());
        if (cols.length < Math.max(walletIdx, codeIdx) + 1) continue;
        const wallet = cols[walletIdx];
        const code   = cols[codeIdx];
        if (!wallet || !code) continue;
        rows.push({ wallet, code });
    }
    return rows;
}

function parsePurchasesCsv(csvText) {
    const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return [];

    const firstCols = lines[0].split(",").map(s => s.trim());
    const lower = firstCols.map(s => s.toLowerCase());
    let startIdx = 0;

    const headerMap = {
        wallet: lower.findIndex(h => ["wallet_address","address","wallet"].includes(h)),
        ref:    lower.findIndex(h => ["referral","referral_code","refcode","code","ref"].includes(h)),
        amount: lower.findIndex(h => ["amount","qty","box","box_count"].includes(h)),
        price:  lower.findIndex(h => ["avg_price","unit_price","price","usdt"].includes(h)),
        time:   lower.findIndex(h => ["created_at","create_at","updated_at","timestamp"].includes(h)),
    };

    const hasHeader = Object.values(headerMap).some(i => i !== -1);
    if (hasHeader) {
        if (headerMap.wallet === -1 || headerMap.amount === -1 || headerMap.price === -1 || headerMap.time === -1) {
            throw new Error("purchase_history.csv 헤더(필수컬럼)를 인식하지 못했습니다.");
        }
        startIdx = 1;
    } else {
        headerMap.wallet = 0; headerMap.ref = 1;
        headerMap.amount = 2; headerMap.price = 3; headerMap.time = 4;
    }

    const rows = [];
    for (let i = startIdx; i < lines.length; i++) {
        const cols = lines[i].split(",").map(s => s.trim());
        const get = idx => (idx >= 0 && idx < cols.length ? cols[idx] : "");
        const wallet = get(headerMap.wallet);
        const ref    = get(headerMap.ref);
        const amount = get(headerMap.amount);
        const price  = get(headerMap.price);
        const time   = get(headerMap.time);
        if (!wallet || !amount || !price || !time) continue;
        rows.push({ wallet, ref, amount, price, time });
    }
    return rows;
}

function normalizeCodeMaybeEmpty(code) {
    const c = String(code || "").trim();
    if (c === "") return "";
    const up = c.toUpperCase();
    if (!/^[A-Z0-9]{8}$/.test(up)) {
        throw new Error(`잘못된 referral 코드 형식: ${code}`);
    }
    return up;
}

function parseUsdtUnits6(val) {
    const s = String(val).trim();
    if (/^\d+$/.test(s)) return BigInt(s) * 10n**6n;
    const parts = s.split(".");
    const left = parts[0].replace(/[^\d]/g,"") || "0";
    const rightRaw = (parts[1] || "").replace(/[^\d]/g,"");
    const right = (rightRaw + "000000").slice(0,6);
    return BigInt(left) * 10n**6n + BigInt(right || "0");
}

function parseBoxCount(val) {
    const s = String(val).trim();
    if (!/^\d+$/.test(s)) throw new Error(`amount(정수 박스 수) 파싱 실패: ${val}`);
    return BigInt(s);
}

function parseEpochSeconds(val) {
    const t = String(val).trim();
    if (/^\d{10}$/.test(t)) return BigInt(t);
    if (/^\d{13}$/.test(t)) return BigInt(t) / 1000n;
    let iso = t;
    if (!/[zZ]|[+\-]\d{2}:?\d{2}/.test(t)) iso = t.replace(" ", "T") + "Z";
    const ms = Date.parse(iso);
    if (Number.isNaN(ms)) throw new Error(`create_at 파싱 실패: ${val}`);
    return BigInt(Math.floor(ms / 1000));
}

// =============================================================================
// 테스트 본문
// =============================================================================

describe("vesting.backfill.fromcsv", function () {
    const MAX_BULK = 10n; // 컨트랙트의 MAX_BACKFILL_BULK와 동일하게 사용(로직상 10)

    it("user.csv로 코드 세팅 후, purchase_history.csv 전체 백필", async () => {
        // === 테스트 환경 설정 ===
        const { owner, vesting, start } = await deployFixture();

        // === 1) user.csv 로드 → setReferralCodesBulk ===
        const userCsv = findCsvText([path.join(__dirname, "../test/data", "user.csv")]);
        const userRows = parseUsersCsv(userCsv);
        expect(userRows.length).to.be.greaterThan(0);

        const users = [];
        const codes = [];
        for (const { wallet, code } of userRows) {
            users.push(ethers.getAddress(wallet));
            const norm = normalizeCodeMaybeEmpty(code);
            if (norm === "") throw new Error(`user.csv에 빈 코드가 있습니다: ${wallet}`);
            codes.push(norm);
        }
        await vesting.connect(owner).setReferralCodesBulk(users, codes, true);

        // === 2) purchase_history.csv 로드 → 벌크 백필 ===
        const purchaseCsv = findCsvText([path.join(__dirname, "../test/data", "purchase_history.csv")]);
        const rows = parsePurchasesCsv(purchaseCsv);
        expect(rows.length).to.be.greaterThan(0);

        // 예상 검증용 누적맵
        const dayTotals = new Map();     // dayIndex -> BigInt (모든 구매 박스 수)
        const refDayTotals = new Map();  // dayIndex -> BigInt (레퍼럴 구매 박스 수)
        const allDays = new Set();

        // 벌크 청크
        let batch = [];
        const flush = async () => {
            if (batch.length === 0) return;
            await vesting.connect(owner).backfillPurchaseBulkAt(batch);
            batch = [];
        };

        for (const row of rows) {
            const buyerAddr = ethers.getAddress(row.wallet);
            const refCodeStr = normalizeCodeMaybeEmpty(row.ref);
            const boxCount = parseBoxCount(row.amount);
            // Amount=0 행은 on-chain 백필 시 'box=0'로 리버트되므로 스킵
            if (boxCount === 0n) continue;
            const price6 = parseUsdtUnits6(row.price);
            const paidUnits = boxCount * price6;
            const purchaseTs = parseEpochSeconds(row.time);

            // day index 계산
            const d = purchaseTs < start ? 0n : (purchaseTs - start) / 86400n;
            allDays.add(d);

            dayTotals.set(d, (dayTotals.get(d) || 0n) + boxCount);
            if (refCodeStr !== "") {
                refDayTotals.set(d, (refDayTotals.get(d) || 0n) + boxCount);
            }

            // 벌크 아이템 추가
            batch.push({
                buyer: buyerAddr,
                refCodeStr,
                boxCount,
                purchaseTs,
                paidUnits
            });

            if (BigInt(batch.length) === MAX_BULK) {
                await flush();
            }
        }
        await flush(); // 잔여분 처리

        // === 3) 검증: 일자별 boxesAddedPerDay / referralsAddedPerDay 일치 ===
        for (const d of allDays) {
            const expectedBoxes = dayTotals.get(d) || 0n;
            const expectedRefs  = refDayTotals.get(d) || 0n;

            const onchainBoxes = await vesting.boxesAddedPerDay(d);
            const onchainRefs  = await vesting.referralsAddedPerDay(d);

            expect(onchainBoxes).to.equal(expectedBoxes, `boxesAddedPerDay mismatch on day ${d}`);
            expect(onchainRefs).to.equal(expectedRefs, `referralsAddedPerDay mismatch on day ${d}`);
        }
    });
});
