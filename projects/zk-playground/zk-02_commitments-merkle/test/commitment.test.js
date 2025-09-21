const { expect } = require("chai");
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

function read(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }

describe("CommitmentVerifier", function () {
    it("verifies snarkjs proof", async () => {
        const build = path.resolve(__dirname, "../build/commitment");
        const proof = read(path.join(build, "proof.json"));
        const pub = read(path.join(build, "public.json"));

        const Verifier = await ethers.getContractFactory("Groth16Verifier");
        const verifier = await Verifier.deploy();
        await verifier.waitForDeployment();

        const a = [proof.pi_a[0], proof.pi_a[1]];
        const b = [
            [proof.pi_b[0][1], proof.pi_b[0][0]],
            [proof.pi_b[1][1], proof.pi_b[1][0]],
        ];
        const c = [proof.pi_c[0], proof.pi_c[1]];
        const input = pub.map(BigInt);

        let ok;
        try { ok = await verifier.verifyProof(a, b, c, input); }
        catch { ok = await verifier.verifyProof({ a, b, c }, input); }
        expect(ok).to.equal(true);
    });
});
