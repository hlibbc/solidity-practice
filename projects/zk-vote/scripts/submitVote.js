// scripts/submitVote.js
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
const { vote, secret } = require("../config");

async function main() {
    const [voter] = await ethers.getSigners();
    const zkVoteAddress = "0xB7f8BC63BbcaD18155201308C8f3540b07f84F5e";
    const ZKVote = await ethers.getContractAt("ZKVote", zkVoteAddress);

    // public.json 에서 10진수 커밋 값 불러오기
    const publicSignals = JSON.parse(
        fs.readFileSync(path.join(__dirname, "public.json"), "utf8")
    );
    const commitmentDec = publicSignals[0];
    console.log("▶ raw commitment (dec):", commitmentDec);

    // 10진수 → BigInt → hex (bytes32)
    const commitmentBigInt = BigInt(commitmentDec);
    const commitmentHex = "0x" + commitmentBigInt.toString(16).padStart(64, "0");
    console.log("▶ commitment (hex):", commitmentHex);

    // 이제 bytes32 타입으로 커밋 제출
    const tx = await ZKVote.connect(voter).commit(commitmentHex);
    await tx.wait();

    console.log("✅ 커밋 완료:", commitmentHex);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
