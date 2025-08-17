// scripts/_shared.js
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { ethers } = hre;

/** argv에서 i번째 인자 가져오기 (node file.js arg0 arg1 ...) */
function argv(i = 0) {
  return process.argv[2 + i];
}

/** 주소 인자 파싱 (argv[0] or env) + 체크섬 검증 */
function pickAddressArg() {
  const raw = argv(0) || process.env.USER_ADDRESS || process.env.ADDRESS;
  if (!raw) {
    throw new Error(
      "사용자 주소가 필요합니다. 예) node scripts/previewBuyerClaimable.js 0xabc... 또는 USER_ADDRESS env 사용"
    );
  }
  try {
    return ethers.getAddress(raw);
  } catch {
    throw new Error(`잘못된 주소 형식입니다: ${raw}`);
  }
}

/** deployment-info.json 로드 (현재 파일 구조에 맞게 정규화) */
function loadDeployment(file = path.join(__dirname, "output", "deployment-info.json")) {
  if (!fs.existsSync(file)) {
    throw new Error(`deployment-info.json이 없습니다: ${file}`);
  }
  const obj = JSON.parse(fs.readFileSync(file, "utf8"));
  const c = obj.contracts || {};

  // 현재 JSON 키
  const vesting =
    c.vesting ||        // 혹시 다른 스크립트에서 이렇게 저장했을 수도 있어 대비
    c.tokenVesting ||   // ← 당신의 JSON에 있는 실제 키
    c.TokenVesting;

  const sbt =
    c.sbt ||
    c.badgeSBT ||       // ← 실제 키
    c.BadgeSBT;

  const stableCoin =
    c.stableCoin ||     // ← 실제 키
    c.StableCoin ||
    c.usdt ||
    c.USDT;

  if (!vesting) {
    throw new Error("deployment-info.json에 contracts.tokenVesting 주소가 없습니다.");
  }

  return {
    vesting,
    sbt,
    stableCoin,
    startTs: obj.startTs ? BigInt(obj.startTs) : undefined,
    forwarder: obj.forwarder,
    network: obj.network,
    raw: obj,
  };
}

/** TokenVesting/BadgeSBT/StableCoin 컨트랙트 인스턴스 attach */
async function attachContracts() {
  const d = loadDeployment();
  const vesting = await ethers.getContractAt("TokenVesting", d.vesting);
  const sbt = d.sbt ? await ethers.getContractAt("BadgeSBT", d.sbt) : null;
  const stable = d.stableCoin ? await ethers.getContractAt("StableCoin", d.stableCoin) : null;
  return { d, vesting, sbt, stable, ethers };
}

/** 과거 호환: vesting만 필요했던 스크립트를 위해 래퍼 제공 */
async function attachVestingWithEthers() {
  const { d, vesting, ethers } = await attachContracts();
  return { d, vesting, ethers };
}

module.exports = {
  // utils
  argv,
  pickAddressArg,
  // deployment
  loadDeployment,
  attachContracts,
  attachVestingWithEthers,
  // re-export ethers in case scripts use it
  ethers,
};
