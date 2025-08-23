// projects/zk-playground/zk-01_basic-arithmetic/circuits/addition.circom
pragma circom 2.0.0;

template Addition() {
    signal input a;
    signal input b;
    signal output c;

    c <== a + b;
}

component main = Addition();
