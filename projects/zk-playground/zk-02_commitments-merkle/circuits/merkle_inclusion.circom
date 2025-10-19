// circuits/merkle_inclusion.circom
pragma circom 2.1.6;
include "poseidon.circom"; // Poseidon 해시 회로

// depth: 머클 트리 높이
template MerkleInclusion(depth) {
    signal input leaf; // 검증하려는 리프
    signal input root; // 기대하는 머클 루트
    signal input pathIndices[depth]; // 0: 왼쪽 or 1: 오른쪽
    signal input pathElements[depth];   // sibling nodes (각 레벨의 형제 노드 값)

    // 컴포넌트 & 신호들
    component H[depth]; // Poseidon 해시 컴포넌트 배열 선언(각 레벨마다 1개)
    signal sel[depth]; // 현재 레벨에서 오른쪽(1)/왼쪽(0)을 담을 선택 신호
    signal notSel[depth]; // 
    signal left[depth]; //
    signal right[depth]; // 
    signal t0[depth]; // 
    signal t1[depth]; // 
    signal t2[depth]; // 
    signal t3[depth]; // 
    signal cur[depth + 1]; // 현재 노드 값(레벨 진행하며 업데이트). 마지막 cur[depth]가 루트가 됨

    // booleanity 강제
    // pathIndices[i]가 반드시 0 또는 1(불리언) 이 되도록 강제하고, 그 보수를 notSel[i]로 만들어서 아래 단계의 왼쪽/오른쪽 선택(mux) 에 쓰기 위함
    for (var i = 0; i < depth; i++) {
        sel[i] <== pathIndices[i]; // 회로 제약: sel[i]와 pathIndices[i]가 같음
        sel[i] * (sel[i] - 1) === 0; // 회로 제약: sel[i]는 0 혹은 1이어야 함
        notSel[i] <== 1 - sel[i]; // notSel[i]는 sel[i]의 보수
    }

    // 시작 leaf
    cur[0] <== leaf;

    // 단계별 머클 연산
    for (var i = 0; i < depth; i++) {
        H[i] = Poseidon(2);

        // left[i], right[i] 계산: 
        // -> sel[i] == 0 이면, left[i] == cur[i], right[i] == sibling
        // -> sel[i] == 1 이면, left[i] == sibling, right[i] == cur[i]
        t0[i]    <== notSel[i] * cur[i];
        t1[i]    <== sel[i] * pathElements[i];
        left[i]  <== t0[i] + t1[i];

        t2[i]    <== notSel[i] * pathElements[i];
        t3[i]    <== sel[i] * cur[i];
        right[i] <== t2[i] + t3[i];

        H[i].inputs[0] <== left[i];
        H[i].inputs[1] <== right[i];

        cur[i + 1] <== H[i].out;
    } // cur[depth] ==> root가 됨

    // 루트 검증 제약
    cur[depth] === root;
}

// main 인스턴스 + root를 public으로 노출
// component main = MerkleInclusion(20);
// public [main.root];
component main { public [root] } = MerkleInclusion(20);
