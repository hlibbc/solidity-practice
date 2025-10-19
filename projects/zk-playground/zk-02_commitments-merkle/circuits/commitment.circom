pragma circom 2.1.6;
include "poseidon.circom";

// 목적: 비공개 입력 secret, salt를 증명자가 알고 있음을 증명하면서, 공개 출력 commitment가 그 해시임을 보장.
// 동작: Poseidon(2) 해시 회로에 두 개의 필드 원소 입력(secret, salt)을 넣어 commitment = Poseidon(secret, salt)를 계산.
template Commitment() {
    signal input secret; // private
    signal input salt; // private
    signal output commitment; // public

    // Poseidon 포인트:
    // - “concat”처럼 바이트를 이어붙이는 개념이 아니라, 두 개의 필드 원소를 해시 함수의 입력 슬롯에 넣는 형태입니다.
    // - h.inputs[0] <== secret; h.inputs[1] <== salt; 제약으로 내부 Poseidon 입력을 고정하고, commitment <== h.out;로 출력과 해시 결과가 같음을 제약합니다.
    // - secret만으로 해시하면 사전공격(딕셔너리 공격)에 취약할 수 있어 salt를 추가해 은닉성(무작위성)을 확보합니다.
    // - 결과 commitment는 공개 신호로 사용되어, 예를 들어 머클 트리의 리프 값 등으로 활용됩니다.
    // component: 템플릿(template)을 실제로 회로 안에 불러와 쓰는 “객체 생성자(new)” 역할
    component h = Poseidon(2);
    h.inputs[0] <== secret;
    h.inputs[1] <== salt;
    commitment <== h.out;
}
component main = Commitment();
