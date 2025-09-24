// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IGroth16Verifier {
    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[] calldata input
    ) external view returns (bool);
}

contract AllowlistByZK {
    IGroth16Verifier public verifier;
    uint256 public merkleRoot;
    mapping(address => bool) public claimed;

    constructor(address _verifier, uint256 _root) {
        verifier = IGroth16Verifier(_verifier);
        merkleRoot = _root;
    }

    function setRoot(uint256 _root) external {
        merkleRoot = _root;
    }

    function claim(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[] calldata input
    ) external {
        require(!claimed[msg.sender], "already claimed");
        require(input.length == 1 && input[0] == merkleRoot, "wrong root");

        bool ok = verifier.verifyProof(a, b, c, input);
        require(ok, "invalid proof");

        claimed[msg.sender] = true;
    }
}
