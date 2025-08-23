pragma circom 2.0.0;

template Division() {
    signal input a;  // dividend
    signal input b;  // divisor
    signal input q;  // quotient
    signal input r;  // remainder

    signal output c; // 공개 출력 (몫 q를 공개)

    // 핵심 제약: a = b*q + r
    a === b * q + r;

    // 공개 출력
    c <== q;
}

component main = Division();
