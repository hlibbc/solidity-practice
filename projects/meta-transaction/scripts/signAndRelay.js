const hre = require("hardhat");
const { ethers } = hre;
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

async function main() {
    const [user, relayer] = await ethers.getSigners();

    const forwarderAddress = process.env.FORWARDER_ADDRESS;
    const receiverAddress = process.env.RECEIVER_ADDRESS;

    const Forwarder = await ethers.getContractFactory("MyDefaultForwarder");
    const Receiver = await ethers.getContractFactory("MetaTxReceiver");

    const forwarder = new ethers.Contract(forwarderAddress, Forwarder.interface, relayer);
    const receiver = await Receiver.attach(receiverAddress);

    console.log("Forwarder Address:", forwarderAddress);
    console.log("Receiver Address:", receiverAddress);

    // Prepare meta-transaction
    const message = "Hello from ERC2771 meta-tx";
    const data = receiver.interface.encodeFunctionData("setMessage", [message]);
    const nonce = await forwarder.nonces(user.address);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    const chainId = (await ethers.provider.getNetwork()).chainId;

    // Prepare typed data
    const domain = {
        name: "MyDefaultForwarder",
        version: "1",
        chainId,
        verifyingContract: forwarderAddress,
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

    const requestToSign = {
        from: user.address,
        to: receiverAddress,
        value: 0,
        gas: 100000,
        nonce,
        deadline,
        data,
    };

    const signature = await user.signTypedData(domain, types, requestToSign);

    const request = {
        ...requestToSign,
        signature,
    };

    console.log("Request:", request);
    console.log("Signature:", signature);
    console.log("Relayer:", relayer.address);

    // Execute meta-tx
    try {
        const tx = await forwarder.connect(relayer).execute(request, { value: 0 });
        const receipt = await tx.wait();
        console.log("Meta-tx relayed! Hash:", tx.hash);
        console.log("Gas used:", receipt.gasUsed.toString());
    } catch (err) {
        console.error("Error relaying meta-tx:", err);
    }
}

main().catch((err) => {
    console.error("Script failed:", err);
    process.exit(1);
});
