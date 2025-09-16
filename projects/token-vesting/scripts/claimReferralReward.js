/**
 * @fileoverview
 *  PRIVATE_KEY 지갑으로 추천인 풀 보상을 전액 클레임하는 스크립트
 *  - 현재(시뮬레이션) 기준 추천인 클레임 가능 양(previewReferrerClaimable) 출력
 *  - 클레임 전/후 지갑의 vestingToken 잔액 출력
 *  - claimReferralReward() 호출로 전액 클레임 수행
 *
 * 실행:
 *   pnpm exec hardhat run scripts/claimReferralReward.js --network <net>
 *
 * 환경변수(../.env):
 *   PRIVATE_KEY   : 트랜잭션을 보낼 사용자 지갑 프라이빗키 (필수)
 *   PROVIDER_URL  : RPC URL (선택, 기본 http://localhost:8545)
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const path = require("path");
const hre = require("hardhat");
const { ethers } = hre;
const Shared = require("./_shared");

// =============================================================================
// 유틸리티
// =============================================================================

/**
 * @notice BigInt 값을 6자리 소수점 단위로 내림 처리
 * @param {bigint} x 18 decimals 기준 금액(BigInt)
 * @returns {bigint} 하위 12자리를 절삭(내림)한 18 decimals 값
 */
function floor6(x) {
    const mod = 10n ** 12n;
    return x - (x % mod);
}

// =============================================================================
// 메인
// =============================================================================

async function main() {
    // ── 0) 지갑/프로바이더
    const pk = process.env.PRIVATE_KEY;
    if (!pk) throw new Error("❌ .env에 PRIVATE_KEY를 설정하세요.");
    const providerUrl = process.env.PROVIDER_URL || "http://localhost:8545";
    const provider = new ethers.JsonRpcProvider(providerUrl);
    const wallet = new ethers.Wallet(pk, provider);

    console.log("🌐 네트워크:", hre.network.name);
    console.log("👤 사용자:", wallet.address);

    // ── 1) 배포정보/컨트랙트 연결
    const d = Shared.loadDeployment(path.join(__dirname, "output", "deployment-info.json"));
    const vesting = await ethers.getContractAt("TokenVesting", d.vesting, wallet);
    console.log("🔗 Vesting:", d.vesting);

    // ── 2) 추천인 클레임 가능(시뮬) 양 조회(18dec)
    const claimable18 = await vesting.previewReferrerClaimable(wallet.address);
    const floored = floor6(claimable18);
    console.log("\n=== Preview Referrer Claimable ===");
    console.log("amount18:", claimable18.toString());
    console.log("floor6→18:", floored.toString(), `(≈ ${ethers.formatUnits(floored, 18)} token)`);

    // ── 3) vestingToken 주소 및 지갑 잔액 조회
    const tokenAddr = await vesting.vestingToken();
    if (tokenAddr === ethers.ZeroAddress) {
        throw new Error("❌ vestingToken이 아직 설정되지 않았습니다.");
    }
    const erc20 = await ethers.getContractAt("IERC20Metadata", tokenAddr, wallet);
    const decimals = await erc20.decimals();
    const preBal = await erc20.balanceOf(wallet.address);
    console.log("\n=== Balance (before claim) ===");
    console.log("vestingToken:", tokenAddr);
    console.log("decimals   :", decimals);
    console.log("balance    :", preBal.toString(), `(≈ ${ethers.formatUnits(preBal, decimals)} token)`);

    // ── 4) 클레임 수행
    if (claimable18 === 0n || floored === 0n) {
        console.log("\n⚠️ 클레임 가능한 금액이 0 입니다. 트랜잭션을 스킵합니다.");
        return;
    }

    console.log("\n🛠️ claimReferralReward() 호출 중...");
    const totals = {};
    await Shared.withGasLog("[claim] referral", vesting.claimReferralReward(), totals, "claim");
    Shared.printGasSummary(totals, ["claim"]);
    console.log("✅ claim 완료");

    // ── 5) 잔액 재확인
    const postBal = await erc20.balanceOf(wallet.address);
    console.log("\n=== Balance (after claim) ===");
    console.log("balance:", postBal.toString(), `(≈ ${ethers.formatUnits(postBal, decimals)} token)`);

    console.log("\n🎉 스크립트 완료");
}

main()
    .then(() => process.exit(0))
    .catch((e) => { console.error("❌ 스크립트 오류:", e); process.exit(1); });


