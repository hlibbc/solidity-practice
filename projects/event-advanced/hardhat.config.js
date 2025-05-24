require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

module.exports = {
  solidity: "0.8.28",
  defaultNetwork: "development", 
  networks: {
    development: {
      url: `http://127.0.0.1:8545`,
      accounts: [process.env.PRIVATE_KEY]
    }
  }
};
