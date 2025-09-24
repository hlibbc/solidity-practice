/* eslint-disable no-undef */
const fs = require("fs");
const path = require("path");

function toPascalCase(s) {
    return s
        .split(/[_-]/g)
        .map((t) => t.charAt(0).toUpperCase() + t.slice(1))
        .join("");
}

function saveDeployment(networkName, payload) {
    const outDir = path.join(__dirname, ".", "output");
    const outPath = path.join(outDir, "deployment-info.json"); // 요청하신 파일명 그대로
    fs.mkdirSync(outDir, { recursive: true });

    let json = {};
    if (fs.existsSync(outPath)) {
        try {
            json = JSON.parse(fs.readFileSync(outPath, "utf8"));
        } catch {
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

async function main() {
    const circuit = "merkle_inclusion"; // 필요하면 인자/환경변수로 바꿔도 됨
    const PascalCircuit = toPascalCase(circuit); // "MerkleInclusion"

    // 1) Verifier 배포 (snarkjs 기본 계약명: Groth16Verifier)
    const fqName = `contracts/${PascalCircuit}Verifier.sol:Groth16Verifier`;
    const Verifier = await ethers.getContractFactory(fqName);
    const verifier = await Verifier.deploy();
    await verifier.waitForDeployment();
    const verifierAddr = await verifier.getAddress();
    console.log("Verifier:", verifierAddr);

    // 2) public root 로드
    const buildDir = path.join(__dirname, "..", "build", circuit);
    const pub = JSON.parse(
        fs.readFileSync(path.join(buildDir, `${circuit}.public.json`), "utf8")
    );
    const root = pub[0];
    console.log("Root:", root);

    // 3) AllowlistByZK 배포
    const Allowlist = await ethers.getContractFactory("AllowlistByZK");
    const allowlist = await Allowlist.deploy(verifierAddr, root);
    await allowlist.waitForDeployment();
    const allowlistAddr = await allowlist.getAddress();
    console.log("AllowlistByZK:", allowlistAddr);

    // 4) 파일로 기록
    const net = await ethers.provider.getNetwork();
    const hreNetName = network?.name || "hardhat"; // HRE network 전역 있을 때
    const payload = {
        chainId: Number(net.chainId),
        contracts: {
            Groth16Verifier: verifierAddr,
            AllowlistByZK: allowlistAddr,
        },
        root: root,
    };
    saveDeployment(hreNetName, payload);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
