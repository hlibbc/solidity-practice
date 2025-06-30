const hre = require("hardhat");
const { ethers } = hre;

async function main() {
    const StorageLayoutExplanation = await ethers.getContractFactory("StorageLayoutExplanation");
    const storageLayoutExplanation = await StorageLayoutExplanation.deploy(); // signer as verifier for demo
    // console.log("Deploying ERC20 tx hash:", myToken.deploymentTransaction().hash);
    await storageLayoutExplanation.waitForDeployment();
    console.log("ERC20 deployed to:", await storageLayoutExplanation.getAddress());
}

main().catch(console.error);