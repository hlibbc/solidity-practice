
require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });

module.exports = {
  solidity: "0.8.20",
  networks: {
    development: {
      url: `http://127.0.0.1:8545`,
      accounts: [process.env.PRIVATE_KEY]
    }
  }
};
