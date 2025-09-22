// scripts/test-lite.js (CJS)
const { poseidon2 } = require('poseidon-lite'); // arity=2
const h = poseidon2([12345n, 67890n]);
console.log('poseidon-lite:', h.toString());    // BigInt → 문자열
