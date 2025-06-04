// test/HackShadeling.test.js

const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("HackShadeling attack test (Hardhat)", function () {
    let Shadeling, HackShadeling;
    let shadeling, hacker;
    let deployer, user;

    before(async function () {
        [deployer, user] = await ethers.getSigners();
        Shadeling = await ethers.getContractFactory("Shadeling", deployer);
        HackShadeling = await ethers.getContractFactory("HackShadeling", deployer);
    });

    beforeEach(async function () {
        // 1) Shadeling 배포
        shadeling = await Shadeling.deploy();
        await shadeling.waitForDeployment();

        // 2) HackShadeling 배포 (Shadeling 주소 전달)
        hacker = await HackShadeling.deploy(await shadeling.getAddress());
        await hacker.waitForDeployment();
    });

    it("hack()을 호출하면 Shadeling.isPredicted가 true가 된다", async function () {
        // 처음에 isPredicted는 false
        expect(await shadeling.isPredicted()).to.equal(false);

        // 3) hack() 호출 (같은 블록의 block.timestamp를 이용해 _random() 예측)
        await hacker.connect(user).hack();

        // 4) 공격 성공 검사
        expect(await shadeling.isPredicted()).to.equal(true);
    });
});
