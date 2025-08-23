pragma circom 2.0.0;

template Subtraction() {
    signal input a;
    signal input b;
    signal output c;   // c = a - b

    c <== a - b;
}

component main = Subtraction();
