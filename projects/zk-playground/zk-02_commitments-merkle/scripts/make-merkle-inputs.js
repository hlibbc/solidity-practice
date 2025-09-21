// scripts/make-merkle-inputs.js  (CJS)
// 우선 poseidon-lite@0.3.0을 시도하고, 실패하면 circomlibjs로 폴백

const fs = require("fs");
const path = require("path");

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

// poseidon-lite 0.3.0은 CommonJS에서 `require('poseidon-lite')`가
// { poseidon: [Function], ... } 형태로 오는 케이스가 일반적임.
// 환경에 따라 default/function일 수도 있어 모두 케이스 처리.
async function loadHash2() {
    // 1) poseidon-lite 시도
    try {
        const pl = require("poseidon-lite");
        // 가장 흔한 케이스: 네임드 poseidon 함수
        if (pl && typeof pl.poseidon === "function") {
            const fn = pl.poseidon;
            return (x, y) => fn([BigInt(x), BigInt(y)]);
        }
        // default 자체가 함수인 경우
        if (pl && typeof pl.default === "function") {
            const fn = pl.default;
            return (x, y) => fn([BigInt(x), BigInt(y)]);
        }
        // require 결과가 바로 함수인 경우
        if (typeof pl === "function") {
            const fn = pl;
            return (x, y) => fn([BigInt(x), BigInt(y)]);
        }
    } catch (_) { /* ignore and fallback */ }

    // 2) circomlibjs 폴백 (테스트에서 이미 잘 동작했던 방식)
    try {
        const cj = require("circomlibjs");
        const buildPoseidon =
            (cj && typeof cj.buildPoseidon === "function") ? cj.buildPoseidon :
            (cj && cj.default && typeof cj.default.buildPoseidon === "function") ? cj.default.buildPoseidon :
            null;

        if (!buildPoseidon) throw new Error("buildPoseidon not found");
        const p = await buildPoseidon();
        return (x, y) => p.F.toObject(p([BigInt(x), BigInt(y)]));
    } catch (_) {}

    throw new Error("Poseidon loader failed (poseidon-lite & circomlibjs).");
}

(async () => {
    try {
        const { leaves, index, depth = 20, secret, salt, pos = 0, others } = parseCLI();
        const hash2 = await loadHash2();

        // 1) 리프 준비
        let leafValues = [];
        if (secret !== undefined && salt !== undefined) {
            const commit = hash2(secret, salt); // BigInt
            if (!others || others.length === 0) {
                leafValues = Array(4).fill(0n);
            } else {
                leafValues = others.map((v) => BigInt(v));
            }
            assert(pos >= 0 && pos <= leafValues.length, `--pos ${pos} is out of range for others length=${leafValues.length}`);
            leafValues.splice(pos, 0, commit);
        } else if (leaves && leaves.length) {
            leafValues = leaves.map((v) => BigInt(v));
        } else {
            throw new Error("Provide either --leaves OR (--secret --salt [--pos] --others).");
        }

        assert(leafValues.length >= 2, "Need at least 2 leaves to build a Merkle tree.");
        const targetIndex = (index !== undefined) ? index : pos;
        assert(0 <= targetIndex && targetIndex < leafValues.length, `--index ${targetIndex} out of range [0, ${leafValues.length - 1}]`);

        // 2) 머클 트리 구성 (홀수면 마지막 복제)
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
        const root = levels[levels.length - 1][0];

        // 3) 대상 leaf의 경로(sibling, 방향) 계산
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

        // 4) 회로 depth 맞춰 패딩
        if (indexBits.length > depth) {
            throw new Error(`Tree depth(${indexBits.length}) exceeds circuit depth(${depth}). Increase circuit depth.`);
        }
        while (indexBits.length < depth) {
            siblings.push(root.toString());
            indexBits.push(0);
        }

        // 5) JSON 출력 (회로 입력 포맷)
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
    } catch (e) {
        console.error("❌", e.message);
        process.exit(1);
    }
})();
