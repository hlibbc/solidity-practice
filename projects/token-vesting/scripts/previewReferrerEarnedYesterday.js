// scripts/previewReferrerEarnedYesterday.js
require("dotenv").config();
const { pickAddressArg, attachVestingWithEthers, ethers } = require("./_shared");

async function main() {
  const user = pickAddressArg();
  const { d, vesting } = await attachVestingWithEthers();

  // 주의: 컨트랙트에 이름을 previewReferrerEarnedYesterday 로 배포하셨다는 가정
  const y18 = await vesting.previewReferrerEarnedYesterday(user);

  console.log("=== Referrer Earned (yesterday) ===");
  console.log("Network :", d.network?.name || process.env.HARDHAT_NETWORK || "unknown");
  console.log("Vesting :", d.vesting);               // ⬅ 여기!
  console.log("User    :", user);
  console.log("amount18:", y18.toString(), `(≈ ${ethers.formatUnits(y18, 18)})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
