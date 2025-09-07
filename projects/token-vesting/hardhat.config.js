// hardhat.config.js
require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config({ path: require("path").resolve(__dirname, "./.env") });
require("@typechain/hardhat");
require("hardhat-contract-sizer");

const { task } = require("hardhat/config");
const { TASK_COMPILE } = require("hardhat/builtin-tasks/task-names");
const { spawn } = require("child_process");

module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true, runs: 200
      },
    },
  },
  contractSizer: {
    alphaSort: true,
    disambiguatePaths: false,
    runOnCompile: false, // ← 컴파일할 때 자동 출력 비활성화
    strict: false, // ← 초과 시 실패 원치 않으면 false
    only: ["TokenVesting"], // 선택: 특정 컨트랙트만
  },
  networks: {
    development: { 
      url: process.env.PROVIDER_URL
    },
    LKtestnet: {
      url: process.env.PROVIDER_URL
    }
  },
};

// ------ 수동 강제 생성 태스크: npx hardhat gen-types ------
task("gen-types", "Force-generate TypeChain typings from artifacts", async () => {
  if (process.platform !== "win32") {
    await new Promise((resolve, reject) => {
      const p = spawn("bash", [
        "-lc",
        `npx typechain --target ethers-v6 --out-dir typechain-types $(find artifacts/contracts -name "*.json" ! -name "*.dbg.json")`,
      ], { stdio: "inherit" });
      p.on("exit", code => code === 0 ? resolve() : reject(new Error(`typechain exited ${code}`)));
    });
  } else {
    await new Promise((resolve, reject) => {
      const p = spawn("npx.cmd", [
        "typechain", "--target", "ethers-v6", "--out-dir", "typechain-types", "artifacts/contracts/**/*.json",
      ], { stdio: "inherit" });
      p.on("exit", code => code === 0 ? resolve() : reject(new Error(`typechain exited ${code}`)));
    });
  }
});

// ------ 컴파일 태스크 오버라이드: 컴파일 후 타입 자동 생성 ------
task(TASK_COMPILE, async (args, hre, runSuper) => {
  const result = await runSuper(args); // ← 원래 compile 실행
  await hre.run("gen-types");          // ← 그리고 타입 강제 생성
  return result;
});
