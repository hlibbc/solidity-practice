// 🧱 디렉토리 구조 (기본 셋업)
// zk-commit-vote/
// ├── circuits/
// │   └── vote.circom
// ├── contracts/
// │   ├── Verifier.sol
// │   └── ZKVote.sol
// ├── scripts/
// │   ├── generateCommit.js
// │   ├── generateProof.js
// │   ├── commitVote.js
// │   └── revealVote.js
// ├── proof.json, public.json, etc
// └── hardhat.config.js

// 💡 각 파일은 이 canvas 아래에 순차적으로 추가해 드릴게요.

// ✅ 먼저 vote.circom 회로 파일 (commit 생성 및 유효성 증명)

pragma circom 2.0.0;

include "circomlib/circuits/poseidon.circom";

// vote (0 또는 1) 와 secret을 입력받아 해시를 출력하고
// vote 값이 반드시 0 또는 1 이어야 함을 강제

template Vote() {
    signal input vote;
    signal input secret;
    signal output hash;

    // vote는 0 또는 1이어야 함 (0 * -1 == 0, 1 * 0 == 0만 true)
    vote * (vote - 1) === 0;

    component hasher = Poseidon(2);
    hasher.inputs[0] <== vote;
    hasher.inputs[1] <== secret;

    hash <== hasher.out;
}

component main = Vote();
