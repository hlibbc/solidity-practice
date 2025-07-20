const { ethers } = require("hardhat");

async function main() {
    const zkVoteAddress = "0xB7f8BC63BbcaD18155201308C8f3540b07f84F5e";
    const ZKVote = await ethers.getContractAt("ZKVote", zkVoteAddress);

    const [yes, no] = await ZKVote.getVoteCounts();
    console.log("📊 찬성:", yes.toString());
    console.log("📊 반대:", no.toString());
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
