const { ethers } = require("hardhat");

async function deployContracts() {
    const [deployer] = await ethers.getSigners();

    const Forwarder = await ethers.getContractFactory("MyForwarder");
    const forwarder = await Forwarder.deploy();
    console.log("Forwarder tx hash:", forwarder.deploymentTransaction().hash);
    await forwarder.waitForDeployment();
    console.log("Forwarder deployed to:", await forwarder.getAddress());

    const Receiver = await ethers.getContractFactory("MetaTxReceiver");
    const receiver = await Receiver.deploy(await forwarder.getAddress());
    await receiver.waitForDeployment();
    console.log("Receiver deployed to:", await receiver.getAddress());

    return { forwarder, receiver };
}

module.exports = { deployContracts };