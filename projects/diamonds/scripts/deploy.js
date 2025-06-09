/* global ethers */
/* eslint prefer-const: "off" */
const { ethers } = require("hardhat");
const { getSelectors, FacetCutAction } = require('./libraries/diamond.js');

async function deployDiamond() {
    const accounts = await ethers.getSigners();
    const contractOwner = accounts[0];

    // Deploy DiamondInit
    const DiamondInit = await ethers.getContractFactory("DiamondInit");
    const diamondInit = await DiamondInit.deploy();
    await diamondInit.waitForDeployment();
    const diamondInitAddress = await diamondInit.getAddress();
    console.log("DiamondInit deployed:", diamondInitAddress);

    // Deploy facets
    console.log("\nDeploying facets...");
    const FacetNames = [
        "DiamondCutFacet",
        "DiamondLoupeFacet",
        "OwnershipFacet"
    ];

    const facetCuts = [];

    for (const FacetName of FacetNames) {
        const Facet = await ethers.getContractFactory(FacetName);
        const facet = await Facet.deploy();
        await facet.waitForDeployment();
        const facetAddress = await facet.getAddress();
        console.log(`${FacetName} deployed: ${facetAddress}`);

        facetCuts.push({
            facetAddress,
            action: FacetCutAction.Add,
            functionSelectors: getSelectors(facet)
        });
    }

    // Encode init() call to run on deployment
    const functionCall = diamondInit.interface.encodeFunctionData("init");

    const diamondArgs = {
        owner: contractOwner.address,
        init: diamondInitAddress,
        initCalldata: functionCall
    };

    const Diamond = await ethers.getContractFactory("Diamond");
    const diamond = await Diamond.deploy(facetCuts, diamondArgs);
    await diamond.waitForDeployment();
    const diamondAddress = await diamond.getAddress();

    console.log("\nDiamond deployed:", diamondAddress);

    return diamondAddress;
}

// CLI 실행용
if (require.main === module) {
    deployDiamond()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error(error);
            process.exit(1);
        });
}

exports.deployDiamond = deployDiamond;
