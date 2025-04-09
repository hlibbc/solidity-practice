const hre = require("hardhat");
const { ethers } = hre;
const { deployContracts } = require("./deployContracts");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

async function loadDeployedContracts() {
    const forwarder = await ethers.getContractAt("MyForwarder", process.env.FORWARDER_ADDRESS);
    const receiver = await ethers.getContractAt("MetaTxReceiver", process.env.RECEIVER_ADDRESS);
    return { forwarder, receiver };
}

async function main() {
    const [user, relayer] = await ethers.getSigners();

    let forwarder, receiver;
    const deployMode = process.argv.includes("--deploy");

    if (deployMode) {
        ({ forwarder, receiver } = await deployContracts());

        const envData = `FORWARDER_ADDRESS=${await forwarder.getAddress()}
RECEIVER_ADDRESS=${await receiver.getAddress()}
`;
        fs.writeFileSync(path.join(__dirname, "../.env"), envData);
        console.log("Contracts deployed and addresses written to .env");
    } else {
        ({ forwarder, receiver } = await loadDeployedContracts());
    }

    const chainId = (await ethers.provider.getNetwork()).chainId;
    const nonce = await forwarder.nonces(user.address);
    const deadline = Math.floor(Date.now() / 1000) + 60 * 60;
    const gasLimit = 100000;

    const data = receiver.interface.encodeFunctionData("setMessage", [
        "Hello from ERC2771 meta-tx",
    ]);

    const request = {
        from: user.address,
        to: await receiver.getAddress(),
        value: 0,
        gas: gasLimit,
        nonce: nonce.toNumber(),
        deadline,
        data,
        signature: "" // placeholder, to be added after signing
    };

    const domain = {
        name: await forwarder.name(),
        version: "1",
        chainId,
        verifyingContract: await forwarder.getAddress(),
    };

    const types = {
        ForwardRequest: [
            { name: "from", type: "address" },
            { name: "to", type: "address" },
            { name: "value", type: "uint256" },
            { name: "gas", type: "uint256" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint48" },
            { name: "data", type: "bytes" },
        ],
    };

    const signature = await user.signTypedData(domain, types, {
        from: request.from,
        to: request.to,
        value: request.value,
        gas: request.gas,
        nonce: request.nonce,
        deadline: request.deadline,
        data: request.data,
    });

    request.signature = signature;

    const forwarderConnected = forwarder.connect(relayer);
    const tx = await forwarderConnected.execute(request, {
        gasLimit: request.gas,
    });
    await tx.wait();

    const [msg, sender] = await receiver.getMessage();
    console.log("✅ MetaTx Success:");
    console.log("Message:", msg);
    console.log("Original Sender:", sender);
}

main().catch(console.error);