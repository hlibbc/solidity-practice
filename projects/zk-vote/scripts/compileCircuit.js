// scripts/compileCircuit.js

const { execSync } = require("child_process");
const path = require("path");

const CIRCUIT_NAME = "vote";
const CIRCUIT_DIR = path.join(__dirname, "..", "circuits");

function run(command) {
    console.log("$", command);
    execSync(command, { stdio: "inherit" });
}

function main() {
    // 1. Compile .circom
    run(`circom ${CIRCUIT_DIR}/${CIRCUIT_NAME}.circom --r1cs --wasm --sym -l node_modules -o ${CIRCUIT_DIR}`);

    // 2. Powers of Tau ceremony (only if not already done)
    run(`npx snarkjs powersoftau new bn128 15 ${CIRCUIT_DIR}/pot15_0000.ptau`);
    run(`npx snarkjs powersoftau contribute ${CIRCUIT_DIR}/pot15_0000.ptau ${CIRCUIT_DIR}/pot15_contributed.ptau --name="contrib" -v`);
    run(`npx snarkjs powersoftau prepare phase2 ${CIRCUIT_DIR}/pot15_contributed.ptau ${CIRCUIT_DIR}/final.ptau`);

    // 3. Generate proving key
    run(`npx snarkjs groth16 setup ${CIRCUIT_DIR}/${CIRCUIT_NAME}.r1cs ${CIRCUIT_DIR}/final.ptau ${CIRCUIT_DIR}/${CIRCUIT_NAME}_000.zkey`);
    run(`npx snarkjs zkey contribute ${CIRCUIT_DIR}/${CIRCUIT_NAME}_000.zkey ${CIRCUIT_DIR}/${CIRCUIT_NAME}.zkey --name="setup"`);

    // 4. Export verifier & verification key
    run(`npx snarkjs zkey export verificationkey ${CIRCUIT_DIR}/${CIRCUIT_NAME}.zkey ${CIRCUIT_DIR}/verification_key.json`);
    run(`npx snarkjs zkey export solidityverifier ${CIRCUIT_DIR}/${CIRCUIT_NAME}.zkey contracts/Verifier.sol`);

    console.log("✅ Circuit compilation complete.");
}

main();
