/**
 * @file check-vrf.js
 * @author hlibbc
 * @notice chainlink-vrf의 동작확인을 위해 아래 동작을 수행한다.
 * 1. 필요한 환경변수 설정
 * 2. WizardTower 컨트랙트 배포
 * 3. consumer 등록
 * 4. polling으로 consumer 등록 확인
 * 5. climb() 호출 후 결과 확인을 위한 사용자 입력 대기
 * @dev 아래 항목들은 사전에 처리되어 있어야 한다.
 * 1. chainlink-vrf의 subscription은 생성되어 있어야 한다.
 *     즉, 아래 항목들은 .env에 정의되어 있어야 함 (chainlink-vrf/.env)
 *     - subscription key-hash
 *     - subscription ID
 * 2. subscription에 수수료 (fund) 는 충전되어 있어야 한다.
 */

const hre = require("hardhat");
const readline = require("readline");
// 모노레포 루트의 .env를 덮어쓰지 않도록, override: false 옵션을 설정함
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env"), override: false });
const { ethers } = hre;

async function main() {
    // 1. 필요한 환경변수
    const subscriptionId = process.env.SUBSCRIPTION_ID;
    const vrfCoordinatorAddress = process.env.VRF_COORDINATOR;
    const keyHash = process.env.KEYHASH;
    const requestConfirmation = parseInt(process.env.REQUEST_CONFIRMATION, 10);
    const nativePayment = process.env.NATIVE_PAYMENT === "true";
    const numWords = 8;
    const callbackGasLimit = parseInt(process.env.CALLBACK_GAS_LIMIT || "2500000", 10);

    // 2. 컨트랙트 배포
    console.log("🚀 WizardTower 배포 중...");
    const WizardTower = await ethers.getContractFactory("WizardTower");
    const wizardTower = await WizardTower.deploy();
    await wizardTower.waitForDeployment();
    const wizardAddress = await wizardTower.getAddress();
    console.log(`✅ 배포 완료: ${wizardAddress}`);

    // 3. consumer 등록
    const vrfAbi = [
        "function addConsumer(uint256 subId, address consumer) external",
        "function getSubscription(uint256 subId) view returns (uint96 balance, uint96 nativeBalance, uint64 reqCount, address owner, address[] consumers)"
    ];
    const coordinator = new ethers.Contract(vrfCoordinatorAddress, vrfAbi, (await ethers.getSigners())[0]);

    console.log("➕ subscription에 consumer 등록 중...");
    const addTx = await coordinator.addConsumer(subscriptionId, wizardAddress);
    await addTx.wait();
    console.log("🕒 등록 확인 중...");

    // 4. polling으로 consumer 등록 확인
    let isRegistered = false;
    for (let i = 0; i < 50; i++) {
        const sub = await coordinator.getSubscription(subscriptionId);
        if (sub.consumers.map(a => a.toLowerCase()).includes(wizardAddress.toLowerCase())) {
            isRegistered = true;
            break;
        }
        console.log(`⏳ consumer 등록 확인 중... (${i + 1}/50)`);
        await delay(1000); // 1초 간격
    }

    if (!isRegistered) {
        console.error("❌ consumer 등록 실패");
        return;
    }
    console.log("✅ consumer 등록 확인 완료");

    // 5. climb() 호출
    console.log("🎲 climb() 호출 중...");
    const tx = await wizardTower.climb(
        keyHash,
        subscriptionId,
        requestConfirmation,
        callbackGasLimit,
        numWords,
        nativePayment
    );
    console.log(`📨 climb() 트랜잭션 전송됨. TX Hash: ${tx.hash}`);
    await tx.wait();
    console.log("✅ 트랜잭션 블록에 포함됨.");

    // 사용자 입력 대기
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    rl.question("🔎 확인하려면 아무 키나 누르고, 종료하려면 q 입력 후 Enter: ", async (answer) => {
        if (answer.trim().toLowerCase() === "q") {
            console.log("👋 종료합니다.");
            rl.close();
            process.exit(0);
        }

        try {
            const final = await wizardTower.floorsClimbed();
            console.log(`📊 floorsClimbed: ${final.toString()}`);
        } catch (err) {
            console.error("❌ floorsClimbed 값 조회 실패:", err);
        }

        rl.close();
    });
}

function delay(ms) {
    return new Promise((res) => setTimeout(res, ms));
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});