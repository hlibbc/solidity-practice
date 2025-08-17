// scripts/previewBuyerClaimable.js
require("dotenv").config();
const { pickAddressArg, attachVestingWithEthers, ethers } = require("./_shared");

function floor6(x) { const mod = 10n ** 12n; return x - (x % mod); }

async function main() {
  const user = pickAddressArg();
  const { d, vesting } = await attachVestingWithEthers();

  const purch18 = await vesting.previewBuyerClaimable(user);

  console.log("=== Buyer Claimable (now) ===");
  console.log("Network  :", d.network?.name || process.env.HARDHAT_NETWORK || "unknown");
  console.log("Vesting  :", d.vesting);             // ⬅ 여기!
  console.log("User     :", user);
  console.log("amount18 :", purch18.toString());
  console.log("floor6→18:", floor6(purch18).toString(), `(≈ ${ethers.formatUnits(floor6(purch18), 18)})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
