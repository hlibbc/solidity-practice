async function main() {
    const MyToken = await ethers.getContractFactory("MyToken");
    const myToken = await MyToken.deploy(); // signer as verifier for demo
    console.log("Deploying ERC20 tx hash:", myToken.deploymentTransaction().hash);
    await myToken.waitForDeployment();
    console.log("ERC20 deployed to:", await myToken.getAddress());
}

main().catch(console.error);