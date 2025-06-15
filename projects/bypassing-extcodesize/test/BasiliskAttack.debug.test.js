// test/BasiliskAttack.test.js
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Basilisk & Attacker Integration", () => {
    let basilisk;
    let attacker;
    let Basilisk;
    let Attacker;
    let deployer;

    before(async () => {
        [deployer] = await ethers.getSigners();
        Basilisk = await ethers.getContractFactory("Basilisk");
        Attacker = await ethers.getContractFactory("Attacker");
    });

    it("should allow Attacker to slay the Basilisk", async () => {
        // 1) Deploy Basilisk
        basilisk = await Basilisk.deploy();
        await basilisk.waitForDeployment();

        // 2) Deploy Attacker (constructor calls enter())
        attacker = await Attacker.deploy(basilisk.target);
        await attacker.waitForDeployment();

        // 3) Before attack, isSlain should be false
        expect(await basilisk.isSlain()).to.equal(false);

        // 4) Execute attack() which calls slay()
        await attacker.attack();

        // 5) After attack, isSlain should be true
        expect(await basilisk.isSlain()).to.equal(true);
    });
});
