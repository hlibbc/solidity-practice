require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });

module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      evmVersion: "shanghai", // Shanghai 환경
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    development: {
      url: `http://127.0.0.1:8545`
    }
  }
}; 