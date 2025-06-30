const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MyToken", function () {
    let myToken;
    let deployer;

    beforeEach(async function () {
        // 첫 번째 signer (default deployer) 사용
        [deployer] = await ethers.getSigners();

        const MyToken = await ethers.getContractFactory("MyToken");
        myToken = await MyToken.deploy();
        await myToken.waitForDeployment();
    });

    it("should return the correct name", async function () {
        expect(await myToken.name()).to.equal("MyToken");
    });

    it("should return the correct symbol", async function () {
        expect(await myToken.symbol()).to.equal("MTK");
    });

    it("should mint initial supply to deployer", async function () {
        const balance = await myToken.balanceOf(deployer.address);
        expect(balance).to.equal(ethers.parseUnits("10000", 18)); // 10000 * 10^18
    });
});
