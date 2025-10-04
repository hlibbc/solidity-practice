pragma circom 2.1.6;

template Booleanity() {
    signal input b; // 기대: 0 또는 1

    // booleanity constraint: b ∈ {0,1}
    b * (b - 1) === 0;
}

template BooleanityArray(n) {
    signal input arr[n]; // 각 원소가 0 또는 1이어야 함
    for (var i = 0; i < n; i++) {
        arr[i] * (arr[i] - 1) === 0;
    }
}

/*
// 단독 테스트용 (예시)
// component main = Booleanity();
*/
