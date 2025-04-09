const { deployContracts } = require("./deployContracts");
const fs = require("fs");
const path = require("path");

async function main() {
    const { forwarder, receiver } = await deployContracts();

    const envData = `FORWARDER_ADDRESS=${await forwarder.getAddress()}
RECEIVER_ADDRESS=${await receiver.getAddress()}
`;
    fs.writeFileSync(path.join(__dirname, "../.env"), envData);

    console.log("Contracts deployed and addresses written to .env");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});