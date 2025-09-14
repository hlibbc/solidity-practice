// test/utils/poseidon.js
// CJS용 Poseidon 유틸 (circomlibjs)
// - 두 입력 해시: poseidon2(a, b)
// - 가변 입력 해시: poseidonHash(inputs)
// - 머클 트리 빌더: buildMerkleTree(leaves), getMerklePath(tree, index)

const { buildPoseidon } = require("circomlibjs");

let _poseidon;

/** Lazy-init Poseidon 인스턴스 */
async function getPoseidon() {
    if (!_poseidon) {
        _poseidon = await buildPoseidon(); // arity-2 기본
    }
    return _poseidon;
}

/** 내부: Field → 10진 문자열 */
function FtoDecStr(poseidon, x) {
    // circomlibjs: F.toObject(...) 가 BigInt 반환
    const v = poseidon.F.toObject(x);
    return v.toString();
}

/** Poseidon(a, b) -> 10진 문자열 */
async function poseidon2(a, b) {
    const p = await getPoseidon();
    const res = p([BigInt(a), BigInt(b)]);
    return FtoDecStr(p, res);
}

/** Poseidon(inputs[]) -> 10진 문자열 */
async function poseidonHash(inputs) {
    const p = await getPoseidon();
    const bigs = inputs.map((x) => BigInt(x));
    const res = p(bigs);
    return FtoDecStr(p, res);
}

/** 머클 트리(이진, Poseidon-2) 빌드: leaves[] 는 10진 문자열/BigInt/number 허용 */
async function buildMerkleTree(leaves) {
    const p = await getPoseidon();
    const norm = leaves.map((x) => BigInt(x));
    const levels = [];
    levels.push(norm);

    let cur = norm;
    while (cur.length > 1) {
        const next = [];
        for (let i = 0; i < cur.length; i += 2) {
            const left = cur[i];
            const right = (i + 1 < cur.length) ? cur[i + 1] : cur[i]; // 홀수 개수 패딩: 마지막을 복제
            const parent = p([left, right]);
            next.push(p.F.toObject(parent)); // BigInt
        }
        levels.push(next);
        cur = next;
    }
    const root = levels[levels.length - 1][0];
    return { levels, root: root.toString() }; // root 10진 문자열
}

/** 특정 leaf index에 대한 (sibling, indexBits) 경로 생성 */
async function getMerklePath(tree, leafIndex) {
    const { levels } = tree; // levels[0] = leaves (BigInt[])
    const siblings = [];
    const indexBits = [];

    let idx = leafIndex;
    for (let d = 0; d < levels.length - 1; d++) {
        const level = levels[d];
        const isRight = (idx % 2 === 1);
        const sibIdx = isRight ? idx - 1 : idx + 1;
        const sibling = (sibIdx < level.length) ? level[sibIdx] : level[idx]; // 패딩 케이스
        siblings.push(sibling.toString());
        indexBits.push(isRight ? 1 : 0);
        idx = Math.floor(idx / 2);
    }
    return { siblings, indexBits };
}

module.exports = {
    getPoseidon,
    poseidon2,
    poseidonHash,
    buildMerkleTree,
    getMerklePath,
};
