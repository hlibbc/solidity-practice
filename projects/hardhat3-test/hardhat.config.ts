import { configVariable, HardhatUserConfig } from "hardhat/config";
import toolboxViem from "@nomicfoundation/hardhat-toolbox-viem";
import hardhatKeystore from "@nomicfoundation/hardhat-keystore";
import hardhatVerify from "@nomicfoundation/hardhat-verify";

const config: HardhatUserConfig = {
  plugins: [toolboxViem, hardhatKeystore, hardhatVerify],
  solidity: {
    version: "0.8.28",
    settings: {
      evmVersion: "cancun",
      optimizer: { enabled: true, runs: 200 }
    }
  },
  networks: {
    development: {
      type: "http",
      chainType: "l1",
      url: "http://127.0.0.1:8545"
    },
    // 예시: 테스트넷(Sepolia)
    sepolia: {
      type: "http",
      chainType: "l1",
      url: configVariable("SEPOLIA_RPC_URL"),
      accounts: [configVariable("SEPOLIA_PRIVATE_KEY")]
    }
  },
  verify: {
    etherscan: {
      // Etherscan(또는 호환 스캐너) API 키
      apiKey: configVariable("ETHERSCAN_API_KEY")
    }
  }
};

export default config;
