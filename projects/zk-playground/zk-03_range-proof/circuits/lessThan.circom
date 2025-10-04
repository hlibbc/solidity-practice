pragma circom 2.1.6;

include "circomlib/circuits/bitify.circom";

/**
 * a < b 를 boolean으로 반환하는 표준 패턴
 * - 전제: a, b ∈ [0, 2^n)
 * - 아이디어:
 *    c = a + (2^n - 1) - b
 *    c ∈ [0, 2^{n+1}) 이므로 Num2Bits(n+1)로 분해 가능
 *    c의 (n)번째 비트가 1이면 a < b, 아니면 0
 */
template LessThanBool(n) {
    signal input a;
    signal input b;
    signal output lt; // 1 if a < b, else 0

    // (안전) a, b를 n비트 정수 범위로 바운딩
    component abit = Num2Bits(n);
    component bbit = Num2Bits(n);
    abit.in <== a;
    bbit.in <== b;

    // c = a + (2^n - 1) - b
    var TWO_N = 1 << n;
    signal c;
    c <== a + (TWO_N - 1) - b;

    // c를 (n+1)비트로 분해
    component cbit = Num2Bits(n + 1);
    cbit.in <== c;

    // MSB가 lt (a<b이면 1)
    lt <== cbit.out[n];

    // lt는 booleanity가 이미 Num2Bits로 보장됨
}

/*
// 단독 테스트용 (예시)
// component main = LessThanBool(13);
*/
