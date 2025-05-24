async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying contracts with:", deployer.address);

    const AAStackDeployer = await ethers.getContractFactory("AAStackDeployer");
    const aaStack = await AAStackDeployer.deploy(deployer.address); // signer as verifier for demo
    await aaStack.waitForDeployment();

    const [entryPoint, walletFactory, paymaster] = await aaStack.getAddresses();
    console.log("EntryPoint deployed to:", entryPoint);
    console.log("WalletFactory deployed to:", walletFactory);
    console.log("Paymaster deployed to:", paymaster);
}

main().catch(console.error);
