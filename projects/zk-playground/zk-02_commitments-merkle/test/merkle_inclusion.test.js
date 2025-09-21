// test/merkle_inclusion.test.js (CJS)
const { expect } = require("chai");
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

function readJSON(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }
const toBigInts = (arr) => arr.map((x) => BigInt(x));

describe("MerkleInclusionVerifier", function () {
    it("verifies merkle inclusion proof (snarkjs)", async () => {
        const BUILD = path.resolve(__dirname, "../build/merkle_inclusion");
        const proof = readJSON(path.join(BUILD, "proof.json"));
        const pub = readJSON(path.join(BUILD, "public.json"));

        // snarkjs 0.7.x 기본 컨트랙트명 = Verifier
        const Verifier = await ethers.getContractFactory("Verifier");
        const verifier = await Verifier.deploy();
        await verifier.waitForDeployment();

        const a = [proof.pi_a[0], proof.pi_a[1]];
        const b = [
            [proof.pi_b[0][1], proof.pi_b[0][0]],
            [proof.pi_b[1][1], proof.pi_b[1][0]],
        ];
        const c = [proof.pi_c[0], proof.pi_c[1]];
        const input = toBigInts(pub);

        let ok;
        try { ok = await verifier.verifyProof(a, b, c, input); }
        catch { ok = await verifier.verifyProof({ a, b, c }, input); }

        expect(ok).to.equal(true);
    });
});
