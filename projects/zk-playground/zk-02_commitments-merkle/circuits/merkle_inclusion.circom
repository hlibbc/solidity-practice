// circuits/merkle_inclusion.circom
pragma circom 2.1.6;
include "poseidon.circom";

template MerkleInclusion(depth) {
    signal input leaf;
    signal input root;
    signal input pathIndices[depth];    // 0 or 1
    signal input pathElements[depth];   // sibling nodes

    // 컴포넌트 & 신호들
    component H[depth];
    signal sel[depth];
    signal notSel[depth];
    signal left[depth];
    signal right[depth];
    signal t0[depth];
    signal t1[depth];
    signal t2[depth];
    signal t3[depth];
    signal cur[depth + 1];

    // booleanity 강제
    for (var i = 0; i < depth; i++) {
        sel[i] <== pathIndices[i];
        sel[i] * (sel[i] - 1) === 0;
        notSel[i] <== 1 - sel[i];
    }

    // 시작 leaf
    cur[0] <== leaf;

    // 단계별 머클 연산
    for (var i = 0; i < depth; i++) {
        H[i] = Poseidon(2);

        t0[i]    <== notSel[i] * cur[i];
        t1[i]    <== sel[i] * pathElements[i];
        left[i]  <== t0[i] + t1[i];

        t2[i]    <== notSel[i] * pathElements[i];
        t3[i]    <== sel[i] * cur[i];
        right[i] <== t2[i] + t3[i];

        H[i].inputs[0] <== left[i];
        H[i].inputs[1] <== right[i];

        cur[i + 1] <== H[i].out;
    }

    // 루트 검증 제약
    cur[depth] === root;
}

// main 인스턴스 + root를 public으로 노출
// component main = MerkleInclusion(20);
// public [main.root];
component main { public [root] } = MerkleInclusion(20);
