// scripts/run_verify.js
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");
const { groth16 } = require("snarkjs");

// CIRCUIT 환경변수 해석 (별칭 허용)
function resolveCircuit() {
  const raw = (process.env.CIRCUIT || "addition").toLowerCase();
  const aliases = {
    add: "addition",
    addition: "addition",
    sub: "subtraction",
    subtraction: "subtraction",
    mul: "multiplication",
    multiply: "multiplication",
    multiplication: "multiplication",
    div: "division",
    division: "division",
  };
  const circuit = aliases[raw] || raw;
  const allowed = new Set(["addition", "subtraction", "multiplication", "division"]);
  if (!allowed.has(circuit)) {
    throw new Error(
      `Invalid CIRCUIT='${raw}'. Allowed: addition | subtraction | multiplication | division`
    );
  }
  return circuit;
}

async function main() {
  const circuit = resolveCircuit();
  console.log(`[run_verify] CIRCUIT=${circuit}`);

  const buildDir = path.join(__dirname, `../build/${circuit}`);
  const proofPath = path.join(buildDir, "proof.json");
  const publicPath = path.join(buildDir, "public.json");

  if (!fs.existsSync(proofPath) || !fs.existsSync(publicPath)) {
    throw new Error(
      `Missing proof/public for '${circuit}'. 먼저 빌드하세요:\n  pnpm --filter zk-01_basic-arithmetic run build ${circuit}`
    );
  }

  const proof = JSON.parse(fs.readFileSync(proofPath, "utf8"));
  const publicSignals = JSON.parse(fs.readFileSync(publicPath, "utf8"));

  // 컨트랙트는 파일마다 이름이 동일(Verifier)이므로 완전 수식 이름 사용
  const fqName = `contracts/${circuit}_Verifier.sol:Groth16Verifier`;
  const Verifier = await ethers.getContractFactory(fqName);
  const verifier = await Verifier.deploy();
  await verifier.waitForDeployment();
  console.log("Verifier deployed at:", await verifier.getAddress());

  const calldata = await groth16.exportSolidityCallData(proof, publicSignals);
  const [a, b, c, input] = JSON.parse("[" + calldata + "]");

  const ok = await verifier.verifyProof(a, b, c, input);
  console.log(`verifyProof(${circuit}) =>`, ok);
  if (!ok) throw new Error("on-chain verification failed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
