/**
 * @file deploy.js
 * @notice StorageLayoutExplanation 컨트랙트 배포 스크립트
 * @author hlibbc
 */
const hre = require("hardhat");
const { ethers } = hre;

/**
 * @notice StorageLayoutExplanation 컨트랙트를 배포한다.
 * @dev ethers v6 버전 사용
 *      - 스토리지 레이아웃을 설명하는 교육용 컨트랙트 배포
 *      - 다양한 데이터 타입들의 스토리지 저장 방식을 시연
 */
async function main() {
    const StorageLayoutExplanation = await ethers.getContractFactory("StorageLayoutExplanation");
    const storageLayoutExplanation = await StorageLayoutExplanation.deploy(); // signer as verifier for demo
    // console.log("Deploying ERC20 tx hash:", myToken.deploymentTransaction().hash);
    await storageLayoutExplanation.waitForDeployment();
    console.log("ERC20 deployed to:", await storageLayoutExplanation.getAddress());
}

main().catch(console.error);