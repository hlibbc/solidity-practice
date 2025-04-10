// create-hardhat-foundry-package.js

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const projectName = process.argv[2];

if (!projectName) {
  console.error("❌ 프로젝트 이름을 인자로 넘겨주세요. 예: node create-hardhat-foundry-package.js proj04");
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
fs.mkdirSync(path.join(projectPath, "foundry", "test"), { recursive: true });
fs.mkdirSync(path.join(projectPath, "lib")); // forge install용

// package.json 생성
console.log("📦 package.json 생성 중...");
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
    "@openzeppelin/contracts": "^5.2.0",
    dotenv: "^16.0.0"
  }
};
fs.writeFileSync(
  path.join(projectPath, "package.json"),
  JSON.stringify(packageJson, null, 2)
);
// .gitignore 추가/수정
console.log("📦 .gitignore 생성 중...");
const gitignorePath = path.join(projectPath, ".gitignore");
const gitignoreContent = `node_modules
foundry/out
foundry/cache
.env
`;
fs.writeFileSync(gitignorePath, gitignoreContent);

// contracts/Example.sol 생성
console.log("📦 contracts/Example.sol 생성 중...");
const exampleContract = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract Example {
    string public greet = "Hello from ${projectName}!";
}
`;
fs.writeFileSync(path.join(projectPath, "contracts", "Example.sol"), exampleContract);

// hardhat.config.js 생성
console.log("📦 hardhat: hardhat.config.js 생성 중...");
const configContent = `
require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });

module.exports = {
  solidity: "0.8.20",
  defaultNetwork: "development", 
  networks: {
    development: {
      url: \`http://127.0.0.1:8545\`
    }
  }
};
`;
fs.writeFileSync(path.join(projectPath, "hardhat.config.js"), configContent);

// foundry.toml 생성
console.log("📦 foundry: foundry.toml 생성 중...");
const foundryToml = `[profile.default]
src = "contracts"
test = "foundry/test"
out = "foundry/out"
libs = ["lib"]
auto_detect_remappings = true
`;

fs.writeFileSync(path.join(projectPath, "foundry.toml"), foundryToml);

// remappings.txt 생성
console.log("📦 foundry: remappings.txt 생성 중...");
fs.writeFileSync(path.join(projectPath, "remappings.txt"), [
  "@contracts/=contracts/",
  "@lib/=lib/",
  "@openzeppelin/=lib/openzeppelin-contracts/"
].join("\n"));

// Foundry forge-std 설치
console.log("📦 의존성 설치 중...");
execSync("pnpm install", { cwd: projectPath, stdio: "inherit" });

console.log("📦 Foundry 유틸 설치 중 (forge-std)...");
execSync("forge install foundry-rs/forge-std --no-commit", {
  cwd: projectPath,
  stdio: "inherit",
});
console.log("📦 Foundry 유틸 설치 중 (openzeppelin)...");
execSync("forge install OpenZeppelin/openzeppelin-contracts --no-commit", {
  cwd: projectPath,
  stdio: "inherit",
});
console.log(`✅ Hardhat + Foundry 프로젝트 생성 완료: projects/${projectName}`);
