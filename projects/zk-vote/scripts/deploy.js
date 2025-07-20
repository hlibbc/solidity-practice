// scripts/deploy.js

const hre = require("hardhat");

async function main() {
    const [deployer] = await hre.ethers.getSigners();
    console.log("Deploying with address:", deployer.address);

    // Verifier 먼저 배포
    const Verifier = await hre.ethers.getContractFactory("Groth16Verifier");
    const verifier = await Verifier.deploy();
    await verifier.waitForDeployment();
    console.log("Verifier deployed at:", await verifier.getAddress());

    // ZKVote 배포, 생성자에 Verifier 주소 전달
    const ZKVote = await hre.ethers.getContractFactory("ZKVote");
    const zkVote = await ZKVote.deploy(await verifier.getAddress());
    await zkVote.waitForDeployment();
    console.log("ZKVote deployed at:", await zkVote.getAddress());

    // 주소를 저장 (선택적)
    const fs = require("fs");
    fs.writeFileSync("deployed.json", JSON.stringify({
        verifier: await verifier.getAddress(),
        zkVote: await zkVote.getAddress()
    }, null, 2));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
