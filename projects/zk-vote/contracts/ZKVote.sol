// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./Verifier.sol";

contract ZKVote {
    Groth16Verifier public verifier;

    mapping(address => bytes32) public commitments;
    mapping(bytes32 => bool) public nullifierHashUsed;

    uint256 public yesCount;
    uint256 public noCount;

    event VoteCommitted(address indexed voter, bytes32 commitment);
    event VoteRevealed(address indexed voter, bool voteValue);

    constructor(address _verifier) {
        verifier = Groth16Verifier(_verifier);
    }

    /// @notice Commit phase: store the hash of (vote, secret)
    function commit(bytes32 commitment) external {
        require(commitments[msg.sender] == bytes32(0), "Already committed");
        commitments[msg.sender] = commitment;
        emit VoteCommitted(msg.sender, commitment);
    }

    /// @notice Reveal phase: submit ZK proof and reveal vote
    function reveal(
        uint[2] memory a,
        uint[2][2] memory b,
        uint[2] memory c,
        uint[1] memory input,
        uint vote
    ) external {
        // input[0] = Poseidon(vote, secret)
        // vote is 0 or 1

        bytes32 expectedCommit = commitments[msg.sender];
        require(expectedCommit != bytes32(0), "No prior commitment");

        bytes32 nullifierHash = keccak256(abi.encodePacked(input[0]));
        require(!nullifierHashUsed[nullifierHash], "Already revealed");

        // Check commitment matches proof public signal
        require(expectedCommit == bytes32(input[0]), "Commitment mismatch");

        // Verify the ZK proof
        require(
            verifier.verifyProof(a, b, c, input),
            "Invalid ZK proof"
        );

        nullifierHashUsed[nullifierHash] = true;

        if (vote == 1) {
            yesCount++;
        } else {
            noCount++;
        }

        emit VoteRevealed(msg.sender, vote == 1);
    }

    /// @notice Get current vote counts
    function getVoteCounts() external view returns (uint256 yes, uint256 no) {
        return (yesCount, noCount);
    }
}
