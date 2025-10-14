/*
    배포 스크립트: VRFProxy, VRFNft
    ------------------------------------------------------------
    - .env에서 환경변수 로드
        - COORDINATOR (오타 대비: COORDIANTOR도 허용)
        - KEYHASH, GASLIMIT, NUMWORDS
    - VRFProxy 배포 (생성자: coordinator)
    - VRFNft 배포 (생성자: vrfProxy.address)
    - VRFProxy.setParams(keyHash, gasLimit, numWords)
    - VRFProxy.setAllowedCaller(vrfNft.address, true)
    - ./output/deployment-info.json에 주소와 네트워크 정보 기록

    사용법 예시
    - pnpm hardhat run scripts/deploy.js --network baobab
*/

require("dotenv").config();
const fs = require("fs");
const path = require("path");

async function main() {
    const hre = require("hardhat");
    const { ethers, network } = hre;

    // 1) 환경 변수 파싱
    const coordinator = process.env.COORDINATOR || process.env.COORDIANTOR; // 오타 대응
    const keyHash = process.env.KEYHASH;
    const gasLimit = Number(process.env.GASLIMIT || 250000);
    const numWords = Number(process.env.NUMWORDS || 1);

    if (!coordinator) throw new Error("Missing env: COORDINATOR (또는 COORDIANTOR)");
    if (!keyHash) throw new Error("Missing env: KEYHASH");
    if (!Number.isFinite(gasLimit)) throw new Error("Invalid env: GASLIMIT");
    if (!Number.isFinite(numWords)) throw new Error("Invalid env: NUMWORDS");

    console.log("Network:", network.name);
    console.log("Coordinator:", coordinator);
    console.log("Params:", { keyHash, gasLimit, numWords });

    // 2) 배포 준비: .env PRIVATE_KEY로 signer 지정
    const privateKey = (process.env.PRIVATE_KEY || "").trim();
    if (!privateKey) throw new Error("Missing env: PRIVATE_KEY");
    const wallet = new ethers.Wallet(privateKey, ethers.provider);
    const deployer = wallet;
    console.log("Deployer:", deployer.address);

    // 3) VRFProxy 배포
    const VRFProxyF = await ethers.getContractFactory("VRFProxy", wallet);
    const vrfProxy = await VRFProxyF.deploy(coordinator);
    await vrfProxy.waitForDeployment();
    const vrfProxyAddress = await vrfProxy.getAddress();
    console.log("VRFProxy deployed:", vrfProxyAddress);

    // 4) VRFNft 배포
    const VRFNftF = await ethers.getContractFactory("VRFNft", wallet);
    const vrfNft = await VRFNftF.deploy(vrfProxyAddress);
    await vrfNft.waitForDeployment();
    const vrfNftAddress = await vrfNft.getAddress();
    console.log("VRFNft deployed:", vrfNftAddress);

    // 5) VRFProxy 파라미터 설정
    const tx1 = await vrfProxy.setParams(keyHash, gasLimit, numWords);
    await tx1.wait();
    console.log("VRFProxy.setParams tx:", tx1.hash);

    // 6) VRFProxy 화이트리스트 설정
    const tx2 = await vrfProxy.setAllowedCaller(vrfNftAddress, true);
    await tx2.wait();
    console.log("VRFProxy.setAllowedCaller tx:", tx2.hash);

    // 7) 결과 저장
    const outDir = path.resolve(__dirname, "./output");
    const outPath = path.join(outDir, "deployment-info.json");
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const networkInfo = await ethers.provider.getNetwork();
    const latestBlock = await ethers.provider.getBlockNumber();
    const data = {
        network: network.name,
        chainId: Number(networkInfo.chainId.toString()),
        deployer: deployer.address,
        vrfProxy: vrfProxyAddress,
        vrfNft: vrfNftAddress,
        params: { keyHash, gasLimit, numWords },
        blockNumber: latestBlock,
        timestamp: new Date().toISOString()
    };
    fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
    console.log("Saved:", outPath);
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });


