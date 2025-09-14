pragma circom 2.1.6;
include "circomlib/poseidon.circom";

template Commitment() {
    signal input secret; // private
    signal input salt; // private
    signal output commitment; // public

    component h = Poseidon(2);
    h.inputs[0] <== secret;
    h.inputs[1] <== salt;
    commitment <== h.out;
}
component main = Commitment();
