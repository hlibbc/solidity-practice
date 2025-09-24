/* eslint-disable no-undef */
const fs = require("fs");
const path = require("path");

function saveDeployment(networkName, payload) {
    const outDir = path.join(__dirname, ".", "output");
    const outPath = path.join(outDir, "deployment-info.json"); // 요청한 파일명 유지
    fs.mkdirSync(outDir, { recursive: true });

    let json = {};
    if (fs.existsSync(outPath)) {
        try {
            json = JSON.parse(fs.readFileSync(outPath, "utf8"));
        } catch (_) {
            json = {};
        }
    }
    if (!json.networks) json.networks = {};
    json.networks[networkName] = {
        ...payload,
        timestamp: new Date().toISOString(),
    };

    fs.writeFileSync(outPath, JSON.stringify(json, null, 4));
    console.log("📄 wrote:", path.relative(process.cwd(), outPath));
}

async function maybeDeployCommitmentVerifier(record) {
    // contracts/CommitmentVerifier.sol 이 없을 수도 있으니 try-catch
    const fqName = "contracts/CommitmentVerifier.sol:Groth16Verifier";
    try {
        const Verifier = await ethers.getContractFactory(fqName);
        const verifier = await Verifier.deploy();
        await verifier.waitForDeployment();
        const addr = await verifier.getAddress();
        console.log("Commitment Groth16Verifier:", addr);
        record.contracts.CommitmentGroth16Verifier = addr;
    } catch (e) {
        console.log("ℹ️ CommitmentVerifier artifact not found. Skip deploying commitment verifier.");
    }
}

async function main() {
    // 1) MerkleInclusion Verifier 배포 (필수)
    const fqMerkle = "contracts/MerkleInclusionVerifier.sol:Groth16Verifier";
    const MerkleVerifier = await ethers.getContractFactory(fqMerkle);
    const merkleVerifier = await MerkleVerifier.deploy();
    await merkleVerifier.waitForDeployment();
    const merkleVerifierAddr = await merkleVerifier.getAddress();
    console.log("Merkle Groth16Verifier:", merkleVerifierAddr);

    // 2) root 로드
    const buildDir = path.join(__dirname, "..", "build", "merkle_inclusion");
    const pub = JSON.parse(
        fs.readFileSync(path.join(buildDir, "merkle_inclusion.public.json"), "utf8")
    );
    const root = pub[0];
    console.log("Root:", root);

    // 3) AllowlistByZK 배포 (Merkle verifier 사용)
    const Allowlist = await ethers.getContractFactory("AllowlistByZK");
    const allowlist = await Allowlist.deploy(merkleVerifierAddr, root);
    await allowlist.waitForDeployment();
    const allowlistAddr = await allowlist.getAddress();
    console.log("AllowlistByZK:", allowlistAddr);

    // 4) (있으면) Commitment Verifier도 배포
    const record = {
        chainId: Number((await ethers.provider.getNetwork()).chainId),
        contracts: {
            MerkleGroth16Verifier: merkleVerifierAddr,
            AllowlistByZK: allowlistAddr,
        },
        root: root,
    };
    await maybeDeployCommitmentVerifier(record);

    // 5) 저장
    const hreName = network?.name || "hardhat";
    saveDeployment(hreName, record);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
