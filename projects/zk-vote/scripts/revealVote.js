// scripts/revealVote.js
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
const { vote } = require("../config");

async function main() {
    const [voter] = await ethers.getSigners();
    const zkVoteAddress = "0xB7f8BC63BbcaD18155201308C8f3540b07f84F5e";
    const ZKVote = await ethers.getContractAt("ZKVote", zkVoteAddress);

    const proof = JSON.parse(fs.readFileSync(path.join(__dirname, "proof.json")));
    const publicSignals = JSON.parse(fs.readFileSync(path.join(__dirname, "public.json")));

    console.log("▶ publicSignals:", publicSignals);
    console.log("▶ vote:", vote);

    const a = [proof.pi_a[0], proof.pi_a[1]];
    const b = [
        [proof.pi_b[0][1], proof.pi_b[0][0]],
        [proof.pi_b[1][1], proof.pi_b[1][0]],
    ];
    const c = [proof.pi_c[0], proof.pi_c[1]];

    const input = [publicSignals[0]];  // commit hash

    const tx = await ZKVote.connect(voter).reveal(a, b, c, input, vote);
    await tx.wait();

    console.log("✅ 투표 공개 및 증명 제출 완료");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
