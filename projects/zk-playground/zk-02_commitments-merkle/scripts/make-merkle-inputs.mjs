// scripts/make-merkle-inputs.mjs  (ESM, robust Poseidon loader: poseidon-lite → circomlibjs fallback)
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1) poseidon-lite (배열 인자) 시도 → 2) circomlibjs buildPoseidon() 폴백
async function loadPoseidonHash2() {
    // A. try poseidon-lite
    try {
        const pl = await import("poseidon-lite");
        const maybeFn = pl.poseidon || pl.default || pl; // 어떤 환경에선 default가 함수
        if (typeof maybeFn === "function") {
            return (x, y) => maybeFn([BigInt(x), BigInt(y)]); // BigInt ← 배열 인자
        }
    } catch (_) { /* ignore and fallback */ }

    // B. fallback: circomlibjs
    const cj = await import("circomlibjs");
    const buildPoseidon =
        cj.buildPoseidon ||
        (cj.default && cj.default.buildPoseidon);
    if (typeof buildPoseidon !== "function") {
        throw new Error("No Poseidon found in poseidon-lite or circomlibjs");
    }
    const poseidon = await buildPoseidon();
    return (x, y) => poseidon.F.toObject(poseidon([BigInt(x), BigInt(y)]));
}

function parseCLI() {
    const args = process.argv.slice(2);
    const opts = {};
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        const next = args[i + 1];
        if (a === "--leaves") opts.leaves = (next || "").split(",").filter(Boolean);
        if (a === "--index") opts.index = parseInt(next, 10);
        if (a === "--depth") opts.depth = parseInt(next, 10);
        if (a === "--secret") opts.secret = next;
        if (a === "--salt") opts.salt = next;
        if (a === "--pos") opts.pos = parseInt(next, 10);
        if (a === "--others") opts.others = (next || "").split(",").filter(Boolean);
    }
    return opts;
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }

async function main() {
    const { leaves, index, depth = 20, secret, salt, pos = 0, others } = parseCLI();

    // 안전한 Poseidon 2-input 해시 함수 로드
    const hash2 = await loadPoseidonHash2();

    // 1) 리프 준비
    let leafValues = [];
    if (secret !== undefined && salt !== undefined) {
        const commit = hash2(secret, salt);
        if (!others || others.length === 0) {
            leafValues = Array(4).fill(0n);
        } else {
            leafValues = others.map((v) => BigInt(v));
        }
        assert(pos >= 0 && pos <= leafValues.length, `--pos ${pos} out of range for others length=${leafValues.length}`);
        leafValues.splice(pos, 0, commit);
    } else if (leaves && leaves.length) {
        leafValues = leaves.map((v) => BigInt(v));
    } else {
        throw new Error("Provide either --leaves OR (--secret --salt [--pos] --others).");
    }

    assert(leafValues.length >= 2, "Need at least 2 leaves to build a Merkle tree.");
    const targetIndex = (index !== undefined) ? index : pos;
    assert(0 <= targetIndex && targetIndex < leafValues.length, `--index ${targetIndex} out of range [0, ${leafValues.length - 1}]`);

    // 2) 머클 트리 구성 (홀수개면 마지막을 복제)
    const levels = [leafValues.slice()];
    let cur = leafValues.slice();
    while (cur.length > 1) {
        const next = [];
        for (let i = 0; i < cur.length; i += 2) {
            const left = cur[i];
            const right = (i + 1 < cur.length) ? cur[i + 1] : cur[i];
            next.push(hash2(left, right));
        }
        levels.push(next);
        cur = next;
    }
    const root = levels.at(-1)[0];

    // 3) 대상 leaf의 경로 계산
    const siblings = [];
    const indexBits = [];
    let idx = targetIndex;
    for (let d = 0; d < levels.length - 1; d++) {
        const level = levels[d];
        const isRight = (idx % 2 === 1);
        const sibIdx = isRight ? idx - 1 : idx + 1;
        const sibling = (sibIdx < level.length) ? level[sibIdx] : level[idx];
        siblings.push(sibling.toString());
        indexBits.push(isRight ? 1 : 0); // 0=left, 1=right
        idx = Math.floor(idx / 2);
    }

    // 4) 회로 depth로 패딩
    if (indexBits.length > depth) {
        throw new Error(`Tree depth(${indexBits.length}) exceeds circuit depth(${depth}). Increase circuit depth.`);
    }
    while (indexBits.length < depth) {
        siblings.push(root.toString());
        indexBits.push(0);
    }

    // 5) 출력 저장 (회로 입력 포맷)
    const out = {
        leaf: levels[0][targetIndex].toString(),
        pathElements: siblings,
        pathIndices: indexBits,
        root: root.toString()
    };

    const ROOT = path.resolve(__dirname, "..");
    const outDir = path.join(ROOT, "inputs");
    const outPath = path.join(outDir, "merkle_inclusion.input.json");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
    console.log("✅ wrote", path.relative(ROOT, outPath));
    console.log("🔹 leaf:", out.leaf);
    console.log("🔹 root:", out.root);
}

main().catch((e) => { console.error("❌", e.message); process.exit(1); });
