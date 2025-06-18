const { transfer } = require("./libs/MyToken");

// CLI 인자: node transfer.js 0xReceiverAddress 1.5
const [,, to, amount] = process.argv;

async function main() {
    if (!to || !amount) {
        console.error("❌ 사용법: node transfer.js <받는주소> <수량(ETH단위)>");
        process.exit(1);
    }

    console.log(`🚀 ${amount} 토큰을 ${to} 주소로 전송 중...`);

    try {
        const tx = await transfer(to, amount);
        console.log("✅ 전송 트랜잭션 해시:", tx.hash);
        await tx.wait();
        console.log("🎉 트랜잭션 완료");
    } catch (err) {
        console.error("❌ 전송 실패:", err);
    }
}

main();
