// scripts/generateProof.js
const snarkjs = require("snarkjs");
const fs      = require("fs");
const path    = require("path");
const { vote, secret } = require("../config");

async function main() {
  const INPUT = { vote, secret };
  const scriptsDir = __dirname;

  try {
    const wasmPath = path.join(__dirname, "..", "circuits", "vote_js",   "vote.wasm");
    const zkeyPath = path.join(__dirname, "..", "circuits", "vote.zkey");

    console.log("▶ INPUT:", INPUT);

    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      INPUT,
      wasmPath,
      zkeyPath
    );

    // scripts 폴더에 저장
    fs.writeFileSync(
      path.join(scriptsDir, "proof.json"),
      JSON.stringify(proof, null, 2)
    );
    fs.writeFileSync(
      path.join(scriptsDir, "public.json"),
      JSON.stringify(publicSignals, null, 2)
    );

    console.log("✅ Proof 생성 완료");
    console.log("📤 publicSignals:", publicSignals);

    process.exit(0);
  } catch (err) {
    console.error("❌ 증명 생성 중 오류 발생:", err);
    process.exit(1);
  }
}

main();
