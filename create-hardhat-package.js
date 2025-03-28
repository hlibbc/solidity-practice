// create-hardhat-package.js

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const projectName = process.argv[2];

if (!projectName) {
  console.error("❌ 프로젝트 이름을 인자로 넘겨주세요. 예: node create-hardhat-package.js prj04");
  process.exit(1);
}

const basePath = path.join(__dirname, "projects");
const projectPath = path.join(basePath, projectName);

if (fs.existsSync(projectPath)) {
  console.error(`❌ ${projectName} 폴더가 이미 존재합니다.`);
  process.exit(1);
}

// 폴더 구조 생성
fs.mkdirSync(projectPath, { recursive: true });
fs.mkdirSync(path.join(projectPath, "contracts"));
fs.mkdirSync(path.join(projectPath, "scripts"));
fs.mkdirSync(path.join(projectPath, "test"));

// package.json 생성
const packageJson = {
  name: projectName,
  version: "1.0.0",
  scripts: {
    compile: "hardhat compile",
    test: "hardhat test",
    deploy: "hardhat run scripts/deploy.js"
  },
  devDependencies: {
    hardhat: "^2.22.0",
    "@nomicfoundation/hardhat-toolbox": "^3.0.0",
    dotenv: "^16.0.0"
  }
};

fs.writeFileSync(
  path.join(projectPath, "package.json"),
  JSON.stringify(packageJson, null, 2)
);

// hardhat.config.js 생성
const configContent = `require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });

module.exports = {
  solidity: "0.8.20",
  networks: {
    development: {
      url: \`http://127.0.0.1:8545\`,
      accounts: [process.env.PRIVATE_KEY]
    }
  }
};
`;

fs.writeFileSync(path.join(projectPath, "hardhat.config.js"), configContent);

// contracts/Example.sol 생성
const exampleContract = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract Example {
    string public greet = "Hello from ${projectName}!";
}
`;

fs.writeFileSync(path.join(projectPath, "contracts", "Example.sol"), exampleContract);

// 자동으로 pnpm install 실행
console.log("📦 의존성 설치 중...");
execSync("pnpm install", { cwd: projectPath, stdio: "inherit" });

console.log(`✅ 프로젝트 생성 완료: projects/${projectName}`);
