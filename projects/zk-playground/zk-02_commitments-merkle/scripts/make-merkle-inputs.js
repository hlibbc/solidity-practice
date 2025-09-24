// scripts/make-merkle-inputs.js  (CJS, fast + with logs, 4-space indent)
// 요구: poseidon-lite >= 0.3.x  (poseidon2 사용)
//
// 사용 예시 1) 리프 직접 지정
//   node scripts/make-merkle-inputs.js --depth 20 --leaves 11,22,33,44 --index 2
//
// 사용 예시 2) (secret,salt) 커밋을 특정 위치에 주입
//   node scripts/make-merkle-inputs.js --depth 20 --secret 12345 --salt 67890 --pos 1 --others 11,22,33,44
//
// 출력: inputs/merkle_inclusion.input.json

const fs = require("fs");
const path = require("path");
const { poseidon2 } = require("poseidon-lite");

function parseCLI() {
    const args = process.argv.slice(2);
    const opts = { depth: 20, verbose: true, check: true };
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
        if (a === "--quiet") opts.verbose = false;
        if (a === "--no-check") opts.check = false;
    }
    return opts;
}

function assert(cond, msg) {
    if (!cond) throw new Error(msg);
}

function ceilLog2(n) {
    let d = 0, m = 1;
    while (m < n) { m <<= 1; d++; }
    return d;
}

// zero_hash[0] = 0; zero_hash[h+1] = H(zero_hash[h], zero_hash[h])
function buildZeroHashes(maxDepth) {
    const zs = new Array(maxDepth + 1);
    zs[0] = 0n;
    for (let h = 0; h < maxDepth; h++) {
        zs[h + 1] = poseidon2([zs[h], zs[h]]);
    }
    return zs;
}

// pathElements/Indices를 이용해 leaf → root 재계산 (회로와 동일한 규칙: 0=left, 1=right)
function reconstructRootFromPath(leaf, pathElements, pathIndices) {
    let cur = BigInt(leaf);
    for (let i = 0; i < pathElements.length; i++) {
        const sib = BigInt(pathElements[i]);
        const isRight = pathIndices[i] === 1 || pathIndices[i] === "1";
        const left = isRight ? sib : cur;
        const right = isRight ? cur : sib;
        cur = poseidon2([left, right]);
    }
    return cur;
}

(function main() {
    const t0 = Date.now();
    try {
        const { leaves, index, depth, secret, salt, pos = 0, others, verbose, check } = parseCLI();
        if (verbose) {
            console.log("▶ start make-merkle-inputs");
            console.log("  • params:", { depth, hasLeaves: !!leaves?.length, hasSecretSalt: secret !== undefined, pos });
        }

        // 1) 리프 준비
        let leafValues = [];
        if (secret !== undefined && salt !== undefined) {
            const commit = poseidon2([BigInt(secret), BigInt(salt)]);
            if (!others || others.length === 0) {
                leafValues = [];
            } else {
                leafValues = others.map((v) => BigInt(v));
            }
            assert(pos >= 0 && pos <= leafValues.length, `--pos ${pos} out of range (others length=${leafValues.length})`);
            leafValues.splice(pos, 0, commit);
        } else if (leaves && leaves.length) {
            leafValues = leaves.map((v) => BigInt(v));
        } else {
            throw new Error("Provide either --leaves OR (--secret --salt [--pos] --others).");
        }

        assert(leafValues.length >= 1, "Need at least 1 leaf.");
        const targetIndex = (index !== undefined) ? index : pos;
        assert(0 <= targetIndex && targetIndex < leafValues.length,
            `--index ${targetIndex} out of range [0, ${leafValues.length - 1}]`);

        if (verbose) {
            console.log(`  • leaves count: ${leafValues.length}`);
            console.log(`  • target index: ${targetIndex} (index ${index === undefined ? "(auto from --pos)" : "(explicit)"} )`);
        }

        // 2) 최소 깊이로 트리 구성 (2^depth0 >= #leaves)
        const depth0 = Math.max(0, ceilLog2(leafValues.length));
        const size0 = 1 << depth0;
        if (verbose) console.log(`▶ build levels up to depth0=${depth0} (size=${size0})`);

        const buildStart = Date.now();
        const level0 = leafValues.slice();
        while (level0.length < size0) level0.push(0n);

        const levels = [level0];
        let cur = level0;
        for (let d = 0; d < depth0; d++) {
            const next = new Array(cur.length / 2);
            for (let i = 0; i < cur.length; i += 2) {
                next[i / 2] = poseidon2([cur[i], cur[i + 1]]);
            }
            levels.push(next);
            cur = next;
            if (verbose) console.log(`    - built level ${d + 1}: nodes=${next.length}`);
        }
        const buildMs = Date.now() - buildStart;
        if (verbose) console.log(`  ✓ built minimal tree in ${buildMs} ms`);

        // 3) zero hashes 준비 (전체 depth까지)
        assert(depth >= depth0, `--depth(${depth}) must be >= minimal depth(${depth0}) for ${leafValues.length} leaves`);
        const zs = buildZeroHashes(depth);
        if (verbose) console.log(`  • precomputed zero hashes up to depth=${depth}`);

        // 4) 전체 루트 계산: minimal root를 위로 zero로 패딩
        let fullRoot = levels[depth0]?.[0] ?? level0[0];
        for (let d = depth0; d < depth; d++) {
            // minimal 트리는 전체 2^depth 공간의 "맨 왼쪽 블럭"이므로 항상 왼쪽에 위치
            fullRoot = poseidon2([fullRoot, zs[d]]);
        }

        // 5) 경로(path) 계산
        const siblings = [];
        const indexBits = [];
        let idx = targetIndex;

        // (a) 실제로 만든 구간(depth0)까지는 levels에서 sibling 추출
        for (let d = 0; d < depth0; d++) {
            const level = levels[d];
            const isRight = (idx % 2 === 1);
            const sibIdx = isRight ? idx - 1 : idx + 1;
            const sibling = level[sibIdx]; // 항상 존재 (패딩했기 때문)
            siblings.push(sibling.toString());
            indexBits.push(isRight ? 1 : 0);
            idx = Math.floor(idx / 2);
        }

        // (b) 남은 구간(depth0→depth)은 zero 서브트리로 패딩
        for (let d = depth0; d < depth; d++) {
            const isRight = (idx % 2 === 1);
            const sibling = zs[d]; // 높이 d의 zero 서브트리 해시
            siblings.push(sibling.toString());
            indexBits.push(isRight ? 1 : 0);
            idx = Math.floor(idx / 2);
        }

        // 6) 출력 JSON
        const out = {
            leaf: levels[0][targetIndex].toString(),
            pathElements: siblings,     // length == depth
            pathIndices: indexBits,     // length == depth (0=left, 1=right)
            root: fullRoot.toString()
        };

        // 7) (옵션) 경로 검증
        if (check) {
            const recon = reconstructRootFromPath(out.leaf, out.pathElements, out.pathIndices);
            assert(recon === BigInt(out.root),
                `reconstructed root mismatch!\n  got:  ${recon}\n  exp:  ${out.root}`);
            if (verbose) console.log("  ✓ path self-check passed (leaf → root reconstruction OK)");
        }

        // 8) 파일 저장
        const ROOT = path.resolve(__dirname, "..");
        const outDir = path.join(ROOT, "inputs");
        const outPath = path.join(outDir, "merkle_inclusion.input.json");
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(outPath, JSON.stringify(out, null, 2));

        const ms = Date.now() - t0;
        console.log("✅ wrote", path.relative(ROOT, outPath));
        console.log("🔹 leaf:", out.leaf);
        console.log("🔹 root:", out.root);
        console.log(`🔹 path depth: ${depth}, siblings: ${out.pathElements.length}`);
        console.log(`⏱  total ${ms} ms`);
    } catch (e) {
        console.error("❌", e.message);
        process.exit(1);
    }
})();
