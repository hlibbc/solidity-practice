const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ShipUsingLibMapTest", function () {

    let testShip;
    let paths = new Set();
    const input = require("./data/paths.json");
    // console.log(input)

    before(async function () {
        const TestShip = await ethers.getContractFactory("ShipUsingLibMap");
        testShip = await TestShip.deploy();
        await testShip.waitForDeployment();
    });

    it('Should be a stateful map', async () => {
        let expectedLocation = "harbor";

        for (const step of input.steps) {

            if (step.action == "AddPath") {

                // Action is to add path
                paths.add(step.from + step.to);
                // console.log(`step.from: ${step.from}`)
                // console.log(`step.to: ${step.to}`)
                // console.log(step.action, paths)
                await testShip.addPath(step.from, step.to);

            } else {

                // console.log(step.action, paths)
                // console.log(`expectedLocation: ${expectedLocation}`)
                // Action is to travel
                const hasPath = paths.has(expectedLocation + step.to);
                // console.log(`hasPath: ${hasPath}`)
                if (hasPath) {
                    expectedLocation = step.to;
                }
                // console.log(`>> expectedLocation: ${expectedLocation}`)
                const tx = testShip.travelAndVerifyResults(
                    step.to, 
                    hasPath, 
                    expectedLocation
                );
                await expect(tx).to.not.be.reverted;
            }
        }
    });

    it('Should avoid storage clashes', async () => {
        expect(await testShip.checkStorageClash(input.slots)).to.be.true;
    });
})