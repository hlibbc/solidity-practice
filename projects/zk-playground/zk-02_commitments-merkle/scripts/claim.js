/* eslint-disable no-undef */
const fs = require("fs");
const path = require("path");

function loadDeployment(networkName) {
    const outPath = path.join(__dirname, ".", "output", "deployment-info.json");
    if (!fs.existsSync(outPath)) {
        throw new Error("deployment-ifno.json not found. Run deploy-allowlist.js first.");
    }
    const json = JSON.parse(fs.readFileSync(outPath, "utf8"));
    if (!json.networks || !json.networks[networkName]) {
        throw new Error(`No deployment entry for network "${networkName}" in deployment-ifno.json`);
    }
    return json.networks[networkName];
}

async function main() {
    const [sender] = await ethers.getSigners();
    const net = await ethers.provider.getNetwork();
    const networkName = network?.name || "unknown";

    const dep = loadDeployment(networkName);
    const allowlistAddr = dep.contracts?.AllowlistByZK;
    if (!allowlistAddr) {
        throw new Error(`AllowlistByZK address missing in deployment-ifno.json for ${networkName}`);
    }

    const Allowlist = await ethers.getContractFactory("AllowlistByZK");
    const allowlist = Allowlist.attach(allowlistAddr);
    console.log("Using Allowlist:", allowlistAddr, "as", sender.address, "on", networkName);

    const buildDir = path.join(__dirname, "..", "build", "merkle_inclusion");
    const proof = JSON.parse(
        fs.readFileSync(path.join(buildDir, "merkle_inclusion.proof.json"), "utf8")
    );
    const pub = JSON.parse(
        fs.readFileSync(path.join(buildDir, "merkle_inclusion.public.json"), "utf8")
    );

    const a = [proof.pi_a[0], proof.pi_a[1]];
    const b = [
        [proof.pi_b[0][1], proof.pi_b[0][0]],
        [proof.pi_b[1][1], proof.pi_b[1][0]],
    ];
    const c = [proof.pi_c[0], proof.pi_c[1]];

    const tx = await allowlist.claim(a, b, c, pub);
    const rc = await tx.wait();
    console.log("claim tx:", rc?.hash);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
