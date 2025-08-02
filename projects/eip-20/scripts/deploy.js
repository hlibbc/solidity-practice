/**
 * @file deploy.js
 * @notice MyToken 컨트랙트 배포 스크립트
 * @author hlibbc
 */
const hre = require("hardhat");
const { ethers } = hre;

/**
 * @notice MyToken 컨트랙트를 배포한다.
 * @dev ethers v6 버전 사용
 */
async function main() {
    const MyToken = await ethers.getContractFactory("MyToken");
    const myToken = await MyToken.deploy(); 

    console.log("Deploying ERC20 tx hash:", myToken.deploymentTransaction().hash);

    await myToken.waitForDeployment();
    console.log("ERC20 deployed to:", await myToken.getAddress());
}

main().catch(console.error);
