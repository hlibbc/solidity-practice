// circuits/merkle_inclusion.circom
pragma circom 2.1.6;
include "poseidon.circom";

// pathIndices[i] 의미: i층에서 내가 오른쪽 자식이면 1, 왼쪽 자식이면 0
// pathElements[i]: i층에서의 sibling 해시
template MerkleInclusion(depth) {
    signal input leaf;
    signal input root;
    signal input pathIndices[depth];   // 0 or 1
    signal input pathElements[depth];  // sibling nodes
    signal output ok;

    signal cur;
    cur <== leaf;

    for (var i = 0; i < depth; i++) {
        component h = Poseidon(2);

        // index=0 -> (cur, sib), index=1 -> (sib, cur)
        signal left;
        signal right;

        left  <== (1 - pathIndices[i]) * cur + pathIndices[i] * pathElements[i];
        right <== (1 - pathIndices[i]) * pathElements[i] + pathIndices[i] * cur;

        h.inputs[0] <== left;
        h.inputs[1] <== right;

        cur <== h.out;
    }

    ok <== cur == root;
}

component main = MerkleInclusion(20);
