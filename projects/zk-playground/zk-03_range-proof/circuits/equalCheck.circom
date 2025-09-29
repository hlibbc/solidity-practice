pragma circom 2.1.6;

// 1) "동등함을 강제"하는 버전 (a == b 여야만 증명 생성 가능)
template EnforceEqual() {
    signal input a;
    signal input b;

    // a == b  ↔  a - b = 0
    a - b === 0;
}

// 2) "동등 여부를 boolean으로 출력"하는 버전 (증명은 항상 생성 가능, eq가 정직해야 함)
template IsEqualBool() {
    signal input a;
    signal input b;
    signal output eq; // 1 if a==b, else 0

    signal diff;
    diff <== a - b;

    // eq ∈ {0,1}
    eq * (eq - 1) === 0;

    // diff == 0 → eq == 1, diff != 0 → eq == 0
    // 표준 패턴: diff * inv = 1 - eq
    signal inv;
    diff * inv === 1 - eq;
}

/*
// 단독 테스트용 (예시)
// component main = EnforceEqual();
// component main = IsEqualBool();
*/
