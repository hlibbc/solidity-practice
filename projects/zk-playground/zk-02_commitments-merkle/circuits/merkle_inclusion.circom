pragma circom 2.1.6;
include "circomlib/poseidon.circom";

template MerkleInclusion(depth) {
    signal input leaf;
    signal input root;
    signal input pathIndices[depth]; // 0 또는 1
    signal input pathElements[depth]; // sibling nodes
    signal output ok;

    var i;
    signal cur; cur <== leaf;

    for (i = 0; i < depth; i++) {
        component h = Poseidon(2);

        signal left;
        signal right;

        // pathIndices[i]가 0이면 (cur, sib), 1이면 (sib, cur)
        left  <== (1 - pathIndices[i]) * cur + pathIndices[i] * pathElements[i];
        right <== (1 - pathIndices[i]) * pathElements[i] + pathIndices[i] * cur;

        h.inputs[0] <== left;
        h.inputs[1] <== right;

        cur <== h.out;
    }
    ok <== cur == root;
}
component main = MerkleInclusion(20);
