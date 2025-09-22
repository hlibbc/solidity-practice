// scripts/merkle-lite.js (CJS)
const { poseidon2 } = require('poseidon-lite');

function merkleRootBigInt(leaves) {
    let level = leaves.map(BigInt);
    while (level.length > 1) {
        if (level.length % 2) level.push(level[level.length - 1]);
        const next = [];
        for (let i = 0; i < level.length; i += 2) {
            next.push(poseidon2([level[i], level[i + 1]])); // BigInt 반환
        }
        level = next;
    }
    return level[0];
}

const root = merkleRootBigInt([11n, 22n, 33n, 44n]);
console.log('root:', root.toString());
