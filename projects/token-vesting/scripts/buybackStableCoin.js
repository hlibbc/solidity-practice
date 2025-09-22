/**
 * @fileoverview
 *  PRIVATE_KEY 지갑으로 스테이블코인 바이백을 청구(claim)하는 스크립트
 *  - 현재 buyback 가능 금액(USDT 단위, 최소단위) 출력
 *  - 클레임 전/후 지갑의 StableCoin 잔액 출력
 *  - claimBuyback() 호출로 전액 클레임 수행
 *
 * 실행:
 *   pnpm exec hardhat run scripts/buybackStableCoin.js --network <net>
 *
 * 환경변수(../.env):
 *   PRIVATE_KEY   : 트랜잭션을 보낼 사용자 지갑 프라이빗키 (필수)
 *   PROVIDER_URL  : RPC URL (선택, 기본 http://localhost:8545)
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const hre = require("hardhat");
const { ethers } = hre;
const Shared = require("./_shared");

// =============================================================================
// 메인
// =============================================================================

async function main() {
    // ── 0) 지갑/프로바이더
    const pk = process.env.REF_PRIVATE_KEY;
    if (!pk) throw new Error("❌ .env에 PRIVATE_KEY를 설정하세요.");
    const providerUrl = process.env.PROVIDER_URL || "http://localhost:8545";
    const provider = new ethers.JsonRpcProvider(providerUrl);
    const wallet = new ethers.Wallet(pk, provider);

    console.log("🌐 네트워크:", hre.network.name);
    console.log("👤 사용자:", wallet.address);

    // ── 1) 배포정보/컨트랙트 연결
    const { d } = await Shared.attachVestingWithEthers();
    const vesting = await ethers.getContractAt("TokenVesting", d.vesting, wallet);
    const stableAddr = await vesting.stableCoin(); // 컨트랙트에서 직접 조회
    const stable = await ethers.getContractAt("IERC20Metadata", stableAddr, wallet);
    const stableDecimals = await stable.decimals();
    console.log("🔗 Vesting:", d.vesting);
    console.log("🔗 StableCoin:", stableAddr);

    // ── 2) buyback 가능한 금액 조회 (StableCoin 최소단위)
    const buyback = await vesting.buybackStableCoinAmount(wallet.address);
    console.log("\n=== Buyback (claimable) ===");
    console.log("raw     :", buyback.toString());
    console.log("formatted:", ethers.formatUnits(buyback, stableDecimals), "token");

    // ── 3) 클레임 전 지갑의 StableCoin 잔액
    const preBal = await stable.balanceOf(wallet.address);
    console.log("\n=== Balance (before claim) ===");
    console.log("balance :", preBal.toString(), `(≈ ${ethers.formatUnits(preBal, stableDecimals)} token)`);

    // ── 4) 클레임 수행
    if (buyback === 0n) {
        console.log("\n⚠️ 클레임 가능한 금액이 0 입니다. 트랜잭션을 스킵합니다.");
        return;
    }
    console.log("\n🛠️ claimBuyback() 호출 중...");
    const totals = {};
    await Shared.withGasLog("[claim] buyback", vesting.claimBuyback(), totals, "claim");
    Shared.printGasSummary(totals, ["claim"]);
    console.log("✅ claim 완료");

    // ── 5) 클레임 후 잔액 재확인
    const postBal = await stable.balanceOf(wallet.address);
    console.log("\n=== Balance (after claim) ===");
    console.log("balance :", postBal.toString(), `(≈ ${ethers.formatUnits(postBal, stableDecimals)} token)`);

    console.log("\n🎉 스크립트 완료");
}

main()
    .then(() => process.exit(0))
    .catch((e) => { console.error("❌ 스크립트 오류:", e); process.exit(1); });


