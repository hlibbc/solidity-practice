
require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config({ path: require("path").resolve(__dirname, "./.env") });

// 필독: 외부 RPC에 연결해서 deploy할 경우, 해당 노드들이 cancun을 지원하지 않을 수 있음
// 이 경우, RPC 사양을 확인해서 맞는 버전으로 재컴파일 요망
// hardhat node의 경우, 2.22.0 이상으로 설치해야 cancun 지원함
// 잘못된 예시: hardhat version 2.13.0 (2022년 10월 릴리스: paris 일부 반영된 버전) -> cancun으로 컴파일한 후 올리면 에러난다.
module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      // evmVersion: "cancun", // 👈 중요: cancun 버전 활성화
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  // defaultNetwork: "development", // --network 생략하려면 필요. but 무조건 외부 provider 띄워야 함
  networks: {
    kairos: {
      url: process.env.PROVIDER_URL
    },
    mainnet: {
      url: process.env.PROVIDER_URL
    }
  }
};
