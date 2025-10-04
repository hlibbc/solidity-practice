pragma circom 2.1.6;

include "circomlib/circuits/bitify.circom";

/**
 * v ∈ [MIN, MAX] 를 강제 (증명은 조건을 만족할 때만 생성 가능)
 * - 권장: n ≥ ceil(log2(MAX - MIN + 1))
 * - 또한 2^n 은 사용 중인 곡선의 소수 p보다 충분히 작아야 모듈러 wrap 위험이 없습니다.
 *   (BN254 기준 실무적으로 n ≤ 128~252 관례)
 */
template RangeProof(n, MIN, MAX) {
    signal input v;

    // 1) 하한: k = v - MIN ≥ 0
    signal k;
    k <== v - MIN;
    component kbits = Num2Bits(n);
    kbits.in <== k; // 0 ≤ k < 2^n  (정수 바운딩)

    // 2) 상한: U = MAX - MIN, U - k ≥ 0  →  k ≤ U  →  v ≤ MAX
    var U = MAX - MIN;
    component ubits = Num2Bits(n);
    ubits.in <== U - k; // 0 ≤ U - k  (정수 바운딩)
}

/*
// 단독 테스트용 (예시)
// component main = RangeProof(13, 10, 300); // v ∈ [10, 300]
*/
