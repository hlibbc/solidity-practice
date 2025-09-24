/* eslint-disable no-undef */
const fs = require("fs");
const path = require("path");
const { expect } = require("chai");

describe("MerkleInclusionVerifier", function () {
    it("verifies proof generated off-chain", async function () {
        // 1) Verifier 컨트랙트 배포
        const circuit = "MerkleInclusion"; // 빌드한 회로명
        const fqName = `contracts/${circuit}Verifier.sol:Groth16Verifier`;
        const Verifier = await ethers.getContractFactory(fqName);
        const verifier = await Verifier.deploy();
        await verifier.waitForDeployment();

        // 2) proof.json / public.json 읽기
        const buildDir = path.join(__dirname, "..", "build", "merkle_inclusion");
        const proof = JSON.parse(fs.readFileSync(path.join(buildDir, "merkle_inclusion.proof.json"), "utf8"));
        const pub = JSON.parse(fs.readFileSync(path.join(buildDir, "merkle_inclusion.public.json"), "utf8"));

        // 3) snarkjs → Solidity calldata 매핑
        const a = [proof.pi_a[0], proof.pi_a[1]];
        const b = [
            [proof.pi_b[0][1], proof.pi_b[0][0]],
            [proof.pi_b[1][1], proof.pi_b[1][0]],
        ];
        const c = [proof.pi_c[0], proof.pi_c[1]];

        // 4) 검증 호출
        const ok = await verifier.verifyProof(a, b, c, pub);
        expect(ok).to.equal(true);
    });    
});
