#!/usr/bin/env node
/**
 * Usage:
 *   node scripts/verify.js <target> [verifierAddress] [rpcUrl]
 *
 * Examples:
 *   # 1) 주소 생략 → deployment_info.json에서 자동 조회
 *   node scripts/verify.js lt13 http://127.0.0.1:8545
 *
 *   # 2) 주소/URL 모두 지정
 *   node scripts/verify.js lt13 0xAbc...def https://rpc.ankr.com/eth
 *
 * What it does:
 *   - Reads ./lib/build/<target>/proof.json and public.json
 *   - If address is omitted, loads it from scripts/output/deployment_info.json by chainId+target
 *   - Uses snarkjs.groth16.exportSolidityCallData to get [a,b,c,input]
 *   - Calls Verifier.verifyProof(a,b,c,input) → prints true/false
 */

const fs = require("fs");
const path = require("path");
const { groth16 } = require("snarkjs");
const { ethers } = require("ethers");

function readJSON(file) {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
        return null;
    }
}

function readVK(buildDir) {
    const vkPath = path.join(buildDir, "verification_key.json");
    try {
        return JSON.parse(fs.readFileSync(vkPath, "utf8"));
    } catch {
        return null;
    }
}

const crypto = require("crypto");
function sha256Hex(s) { return crypto.createHash("sha256").update(s).digest("hex"); }
function readVKRaw(buildDir) {
    const fs = require("fs"); const path = require("path");
    return fs.readFileSync(path.join(buildDir, "verification_key.json"), "utf8");
}

async function main() {
    const [, , target, addrOrRpc, maybeRpc] = process.argv;
    if (!target) {
        console.error("Usage: node scripts/verify.js <target> [verifierAddress] [rpcUrl]");
        process.exit(1);
    }

    // Parse args in both forms:
    // 1) target, address, rpc
    // 2) target, rpc (address omitted)
    let verifierAddress = null;
    let rpcUrl = null;
    if (addrOrRpc && addrOrRpc.startsWith("http")) {
        rpcUrl = addrOrRpc;
    } else {
        verifierAddress = addrOrRpc || null;
        rpcUrl = maybeRpc || process.env.RPC_URL || "http://127.0.0.1:8545";
    }
    if (!rpcUrl) rpcUrl = "http://127.0.0.1:8545";

    const ROOT = path.resolve(__dirname, "..");
    const buildDir = path.join(ROOT, "lib", "build", target);
    const proofPath = path.join(buildDir, "proof.json");
    const publicPath = path.join(buildDir, "public.json");

    if (!fs.existsSync(proofPath) || !fs.existsSync(publicPath)) {
        console.error(`[ERR] Missing proof/public:
  - ${proofPath}
  - ${publicPath}`);
        process.exit(1);
    }

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const net = await provider.getNetwork();
    const chainId = net.chainId.toString();

    // Auto-load address if omitted
    if (!verifierAddress) {
        const infoPath = path.join(ROOT, "scripts", "output", "deployment_info.json");
        const info = readJSON(infoPath);
        const addr = info?.[chainId]?.[target]?.address;
        if (!addr) {
            console.error(`[ERR] No stored address for chainId=${chainId}, target=${target}
  → Deploy first: PRIVATE_KEY=0x... node scripts/deploy.js ${target} ${rpcUrl}`);
            process.exit(1);
        }
        verifierAddress = addr;
    }

    // Sanity: contract code exists?
    const code = await provider.getCode(verifierAddress);
    if (code === "0x") {
        console.error(`[ERR] No contract code at ${verifierAddress}. Did you deploy *_Verifier.sol on chainId=${chainId}?`);
        process.exit(1);
    }

    const proof = JSON.parse(fs.readFileSync(proofPath, "utf8"));
    const publicSignals = JSON.parse(fs.readFileSync(publicPath, "utf8"));

    const calldataStr = await groth16.exportSolidityCallData(proof, publicSignals);
    const normalized = `[${calldataStr}]`.replace(/\s+/g, "");
    const [a, b, c, input] = JSON.parse(normalized);

    // --- 보정: public=0 회로에서 snarkjs가 [0]을 내보내는 경우 허용 ---
    // vKey 기반으로 public signals와 ABI 타입 결정
    const vkey = readVK(buildDir);
    let inputType = "uint256[]";  // default
    if (vkey && typeof vkey.nPublic === "number" && vkey.nPublic > 0) {
        inputType = `uint256[${vkey.nPublic}]`;
    }

    // input 값 보정: nPublic == 0 이면 빈 배열이어야 함
    if (vkey && vkey.nPublic === 0) {
        if (Array.isArray(input) && input.length === 1) {
            const only = String(input[0]).toLowerCase();
            if (only === "0" || only === "0x0" || /^0x0+$/.test(only)) {
                input = [];  // 빈 배열로 강제
            }
        }
    } else if (vkey && vkey.nPublic > 0) {
        // 길이 경고만
        if (!Array.isArray(input) || input.length !== vkey.nPublic) {
            console.warn(`[WARN] public length mismatch: expected=${vkey.nPublic}, got=${Array.isArray(input) ? input.length : -1}`);
        }
    }

    // ★ 여기서 ABI를 vKey에 맞춰 생성 (고정배열/동적배열 자동 선택)
    const abi = [
        `function verifyProof(uint256[2] a, uint256[2][2] b, uint256[2] c, ${inputType} input) external view returns (bool)`
    ];

    console.log("\n[VERIFY]");
    console.log(`  target   : ${target}`);
    console.log(`  chainId  : ${chainId}`);
    console.log(`  contract : ${verifierAddress}`);
    console.log(`  rpc      : ${rpcUrl}`);
    console.log(`  public   : ${JSON.stringify(input)}`);

    // ... verifierAddress 로드 후, callData 만들기 전에:
    let vkHashLocal = null, vkHashDeployed = null;
    try { vkHashLocal = sha256Hex(readVKRaw(buildDir)); } catch {}
    try {
        const info = JSON.parse(fs.readFileSync(path.join(__dirname, "output", "deployment_info.json"), "utf8"));
        const chain = info[chainId] || {};
        vkHashDeployed = chain[target]?.vkHash || null;
    } catch {}

    if (vkHashLocal && vkHashDeployed && vkHashLocal !== vkHashDeployed) {
        console.error(`[ERR] VerifyingKey mismatch!
    - local : ${vkHashLocal}
    - onchain: ${vkHashDeployed}
    Re-export Verifier from current zkey and redeploy (./scripts/build.sh verifier ${target} → npx hardhat run scripts/deploy.js).`);
        process.exit(1);
    }

    console.log(`  vkHash(local): ${vkHashLocal || "null"}`);
    console.log(`  vkHash(chain): ${vkHashDeployed || "null"}`);

    const vkeyFull = readVK(buildDir);
    const okOff = await groth16.verify(vkeyFull, publicSignals, proof);
    console.log(`[off-chain verify] ${okOff ? "OK" : "FAIL"}`);
    console.log(`  abi input type: ${inputType}`); // lt13은 uint256[1]이어야 정상



    // 컨트랙트 인스턴스 생성 및 호출
    const verifier = new ethers.Contract(verifierAddress, abi, provider);
    const ok = await verifier.verifyProof(a, b, c, input);
    console.log(`\nresult: ${ok ? "✅ VALID" : "❌ INVALID"}`);

    // ensure provider shutdown so node process can exit cleanly (ethers v6 keeps timers)
    try { if (typeof provider.destroy === "function") provider.destroy(); } catch {}
    process.exit(ok ? 0 : 2);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
