/*
    RNG 실행 스크립트
    ------------------------------------------------------------
    - scripts/output/deployment-info.json에서 VRFProxy, VRFNft 주소 로드
    - .env의 PRIVATE_KEY와 PROVIDER_URL로 signer 구성
    - mint()를 1 KLAY를 첨부해 호출
    - 호출 전/후 지갑 잔액 출력
    - MintFinalized 이벤트를 대기한 뒤 requestId와 randMap[requestId]를 조회하여 출력
*/

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");

// VRFNft ABI (이벤트, 필요한 함수만 최소화)
const VRFNftAbi = [
    "event MintQueued(uint256 indexed requestId, address indexed to, uint256 tokenId)",
    "event MintFinalized(uint256 indexed requestId, address indexed to, uint256 tokenId, uint256 rand)",
    "function mint() external payable returns (uint256)",
    "function randMap(uint256) external view returns (uint256)"
];

async function main() {
    // output 고정
    const outPath = path.resolve(__dirname, "./output/deployment-info.json");
    if (!fs.existsSync(outPath)) throw new Error(`deployment-info.json not found: ${outPath}`);
    const info = JSON.parse(fs.readFileSync(outPath, "utf8"));

    const vrfNftAddress = info.vrfNft;
    if (!vrfNftAddress) throw new Error("vrfNft address missing in deployment-info.json");

    const providerUrl = process.env.PROVIDER_URL;
    const privateKey = (process.env.PRIVATE_KEY || "").trim();
    if (!providerUrl) throw new Error("Missing env: PROVIDER_URL");
    if (!privateKey) throw new Error("Missing env: PRIVATE_KEY");

    const provider = new ethers.JsonRpcProvider(providerUrl);
    const wallet = new ethers.Wallet(privateKey, provider);

    const nft = new ethers.Contract(vrfNftAddress, VRFNftAbi, wallet);

    const before = await provider.getBalance(wallet.address);
    console.log("Balance before:", ethers.formatEther(before), "KLAY");

    const value = ethers.parseEther("1.0"); // 1 KLAY
    const tx = await nft.mint({ value });
    console.log("mint tx:", tx.hash);
    const receipt = await tx.wait();

    // MintQueued에서 requestId를 바로 얻을 수도 있지만, 최종 완료 이벤트를 대기
    console.log("Waiting for MintFinalized...");
    const requestId = await waitForMintFinalized(provider, vrfNftAddress, wallet.address, receipt.blockNumber);

    const after = await provider.getBalance(wallet.address);
    console.log("Balance after:", ethers.formatEther(after), "KLAY");

    // randMap 조회
    const rand = await nft.randMap(requestId);
    console.log("requestId:", requestId.toString());
    console.log("rand:", rand.toString());
}

async function waitForMintFinalized(provider, contractAddress, toAddress, fromBlock) {
    const iface = new ethers.Interface(VRFNftAbi);
    const topic0 = iface.getEvent("MintFinalized").topicHash;
    const topicTo = ethers.zeroPadValue(ethers.getAddress(toAddress), 32);

    const timeoutAt = Date.now() + 5 * 60 * 1000; // 5분 타임아웃
    let cursor = Number(fromBlock);

    while (Date.now() < timeoutAt) {
        const latest = await provider.getBlockNumber();
        const toBlock = latest;
        if (cursor <= toBlock) {
            const logs = await provider.getLogs({
                address: contractAddress,
                topics: [topic0, null, topicTo],
                fromBlock: cursor,
                toBlock
            });
            if (logs.length > 0) {
                // 마지막 로그 사용
                const log = logs[logs.length - 1];
                const parsed = iface.parseLog({ topics: log.topics, data: log.data });
                return parsed.args[0]; // requestId
            }
            cursor = toBlock + 1;
        }
        await new Promise((r) => setTimeout(r, 4000));
    }
    throw new Error("Timeout waiting for MintFinalized");
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });


