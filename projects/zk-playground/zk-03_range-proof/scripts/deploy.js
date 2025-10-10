#!/usr/bin/env node
/**
 * Run:
 *   npx hardhat run scripts/deploy.js --network <net>
 *   # 예) npx hardhat run scripts/deploy.js --network development
 *
 * 기능:
 * - 타겟(아래 TARGETS)별 *_Verifier.sol 배포
 * - 각 타겟의 verification_key.json을 읽어 nPublic 확인
 *   - nPublic === 0 인 회로에만 'uint[0] calldata _pubSignals' → 'uint[] memory _pubSignals' 패치
 *   - nPublic > 0 인 회로는 절대 수정하지 않음 (lt13 포함)
 * - 파일 내 실제 contract 이름을 자동 추출(FQN으로 정확히 배포)
 * - 결과는 scripts/output/deployment_info.json 에 chainId/target별 기록 (vkHash 포함)
 */

const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const TARGETS = [
    "booleanity",
    "equal_enforce",
    "equal_bool",
    "lt13",
    "range_13_10_300",
];

function readJSON(file, fallback = null) {
    try { return JSON.parse(fs.readFileSync(file, "utf8")); }
    catch { return fallback; }
}
function writeJSON(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 4));
}

const crypto = require("crypto");
function sha256Hex(s) { return crypto.createHash("sha256").update(s).digest("hex"); }
function readVKRaw(buildDir) {
    const p = path.join(buildDir, "verification_key.json");
    return fs.readFileSync(p, "utf8");
}
function readVKey(buildDir) {
    return readJSON(path.join(buildDir, "verification_key.json"), null);
}

/**
 * nPublic이 0인 회로의 Verifier에서만
 *   uint[0] calldata _pubSignals → uint[] memory _pubSignals
 * 로 안전 패치한다.
 * - 다른 문자열은 건드리지 않는다.
 * - 이미 패치된 경우 변경 없음.
 */
function patchVerifierIfZeroPublic(solPath, nPublic) {
    if (nPublic !== 0) {
        // 공개신호가 1개 이상이면 패치 금지
        return false;
    }
    if (!fs.existsSync(solPath)) return false;

    const before = fs.readFileSync(solPath, "utf8");
    let src = before;

    // 가장 보수적으로, 정확히 'uint[0] calldata _pubSignals' 만 대체
    src = src.replace(/uint\[\s*0\s*\]\s+calldata\s+_pubSignals/g, "uint[] memory _pubSignals");

    // 일부 snarkjs 버전에서 memory 표기를 이미 쓸 수도 있으니, 여분의 패치는 하지 않음

    if (src !== before) {
        fs.writeFileSync(solPath, src);
        console.log(`  [PATCH] ${path.basename(solPath)} (nPublic=0) → 'uint[] memory _pubSignals'`);
        return true;
    }
    return false;
}

/** 파일 내용에서 실제 계약명 추출 (첫 번째 contract 선언) */
function extractContractName(solPath) {
    const src = fs.readFileSync(solPath, "utf8");
    const m = src.match(/contract\s+([A-Za-z0-9_]+)\s*/);
    if (m && m[1]) return m[1];
    throw new Error(`Contract name not found in ${solPath}`);
}

async function deployOne(target, outPath) {
    const contractsDir = path.join(__dirname, "..", "contracts");
    const guessedName = `${target}_Verifier`;
    const solPath = path.join(contractsDir, `${guessedName}.sol`);
    if (!fs.existsSync(solPath)) {
        console.warn(`[SKIP] Not found: ${solPath}`);
        return null;
    }

    // nPublic 검사 → zero-public만 패치
    const buildDir = path.join(__dirname, "..", "lib", "build", target);
    const vkey = readVKey(buildDir);
    if (!vkey) {
        console.warn(`[WARN] No verification_key.json for target=${target}. Did you run './scripts/build.sh key ${target}'?`);
    } else {
        const nPublic = (typeof vkey.nPublic === "number") ? vkey.nPublic : null;
        if (nPublic === 0) {
            patchVerifierIfZeroPublic(solPath, 0);
        } else {
            // nPublic > 0 (예: lt13은 1) → 패치 금지
        }
    }

    // 파일 안의 실제 contract 이름 추출 (보통 Groth16Verifier)
    const contractName = extractContractName(solPath);

    // Hardhat FQN은 "contracts/파일.sol:컨트랙트명"
    const fileName = path.basename(solPath);
    const fqn = `contracts/${fileName}:${contractName}`;

    console.log(`\n[DEPLOY] target=${target}`);
    console.log(`         file=${fileName}`);
    console.log(`         contract(in-file)=${contractName}`);
    console.log(`         fqn=${fqn}`);
    console.log(`         network=${hre.network.name}`);

    const [deployer] = await hre.ethers.getSigners();
    const net = await hre.ethers.provider.getNetwork();
    const chainId = net.chainId.toString();

    console.log(`         chainId=${chainId}`);
    console.log(`         from=${deployer.address}`);

    // FQN으로 정확히 지정 (중복 계약명 충돌 방지)
    const factory = await hre.ethers.getContractFactory(fqn, deployer);

    const contract = await factory.deploy();
    await contract.waitForDeployment();
    const address = await contract.getAddress();
    const tx = contract.deploymentTransaction();
    const receipt = await tx.wait();

    console.log(`[OK] Deployed ${contractName} at ${address}`);
    console.log(`     Tx: ${receipt.hash}`);

    // 배포 기록 저장 (+ vkHash)
    const out = readJSON(outPath, {});
    const now = new Date().toISOString();
    if (!out[chainId]) out[chainId] = {};

    let vkHash = null;
    try { vkHash = sha256Hex(readVKRaw(buildDir)); } catch (e) {}

    out[chainId][target] = {
        address,
        txHash: receipt.hash,
        contract: contractName,
        network: hre.network.name,
        vkHash,
        updatedAt: now,
    };
    writeJSON(outPath, out);
    console.log(`     Saved: ${outPath}`);

    return { chainId, target, address, contractName };
}

async function main() {
    // 컴파일 전에 zero-public 대상만 한정 패치
    console.log("[INFO] Checking zero-public verifier patch targets...");
    for (const t of TARGETS) {
        const solPath = path.join(__dirname, "..", "contracts", `${t}_Verifier.sol`);
        const buildDir = path.join(__dirname, "..", "lib", "build", t);
        const vkey = readVKey(buildDir);
        if (!vkey) continue;
        if (vkey.nPublic === 0) {
            patchVerifierIfZeroPublic(solPath, 0);
        }
    }

    // 컴파일
    await hre.run("compile");

    // 배포
    const outPath = path.join(__dirname, "output", "deployment_info.json");
    const results = [];
    for (const t of TARGETS) {
        const r = await deployOne(t, outPath);
        if (r) results.push(r);
    }

    // 요약
    if (results.length > 0) {
        console.log("\n[SUMMARY]");
        for (const r of results) {
            console.log(`- ${r.target} (${r.contractName}) @ ${r.address}`);
        }
    } else {
        console.log("[SUMMARY] nothing deployed");
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
