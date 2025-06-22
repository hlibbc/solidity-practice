
require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config({ path: require("path").resolve(__dirname, "./.env") });

module.exports = {
  solidity: {
    // version: "0.8.28",
    // settings: {
    //   evmVersion: "cancun", // 👈 중요: cancun 버전 활성화
    //   optimizer: {
    //     enabled: true,
    //     runs: 200
    //   }
    // }
    version: "0.8.24", // status network test 용 (cancun 지원하지 않음)
  },
  // defaultNetwork: "development", // --network 생략하려면 필요. but 무조건 외부 provider 띄워야 함
  networks: {
    development: {
      url: `http://127.0.0.1:8545`,
      chainId: 1660990954,
      accounts: [process.env.PRIVATE_KEY]
    },
    snt: { // status-network testnet
      url: `https://public.sepolia.rpc.status.network`,
      accounts: [process.env.PRIVATE_KEY]
    }
  }
};
