// scripts/test.js  (CJS, Node 18/20/22)
(async () => {
    // 1) circomlibjs 버전/익스포트 탐지 + fallback
    let buildPoseidon;
    let circomVer = 'unknown';

    try {
        const cl = require('circomlibjs');                 // 케이스 A: 일반 CJS 내보내기
        try { circomVer = require('circomlibjs/package.json').version; } catch {}
        if (typeof cl.buildPoseidon === 'function') buildPoseidon = cl.buildPoseidon;
    } catch {}

    if (!buildPoseidon) {
        try {
            // 케이스 B: 명시적 CJS 번들 경로 (있을 때만)
            ({ buildPoseidon } = require('circomlibjs/dist/poseidon_wasm.cjs'));
        } catch {}
    }

    if (!buildPoseidon) {
        // 케이스 C: ESM 소스 경로를 CJS에서 동적 import로 불러오기
        // (일부 패키지/예제 문서가 이 경로를 안내합니다)
        ({ buildPoseidon } = await import('circomlibjs/src/poseidon_wasm.js')); // ESM
    }

    if (typeof buildPoseidon !== 'function') {
        throw new Error('circomlibjs에서 buildPoseidon을 찾지 못했습니다 (CJS).');
    }

    // 2) Poseidon 인스턴스 사용
    const poseidon = await buildPoseidon();
    const F = poseidon.F;

    const secret = 12345n;
    const salt   = 67890n;

    const commitment = poseidon([secret, salt]);
    const asBigInt   = F.toObject(commitment);

    const toHex = (x) => '0x' + BigInt(x).toString(16);

    console.log('circomlibjs version:', circomVer);
    console.log('commitment (field):', F.toString(commitment));
    console.log('commitment (hex):', toHex(asBigInt));
})();
