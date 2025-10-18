// projects/zk-playground/zk-01_basic-arithmetic/circuits/addition.circom
pragma circom 2.0.0;

// Addition 회로 정의
// template: 회로의 설계도
template Addition() {
    signal input  a; // 입력신호
    signal input  b; // 입력신호
    signal output c; // 출력신호 

    c <== a + b;
}

// Addition 인스턴스
// component: 설계도 (template) 로부터 생성된 인스턴스 (실체)
component main = Addition();
