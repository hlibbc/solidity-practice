/**
 * @file create-sub-solidity-proj.js
 * @fileoverview Create a sub solidity project.
 * @author hlibbc
 * @created 2025-03-28
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// const projectName = process.argv[2];
const projectName = process.argv[2];
const pkgName = projectName.split("/").pop(); // 프로젝트 내 서브프로젝트 식별 (ex. zk-playground/zk-01_basic-arithmetic)

if (!projectName) {
  console.error("❌ 프로젝트 이름을 인자로 넘겨주세요. 예: node create-monorepo-solidity-proj.js proj04");
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
// hardhat-toolbox 버전: HH2에선 3.0.0이 안정적, HH3로 올릴경우 최신버전으로..
console.log("📦 package.json 생성 중...");
const packageJson = {
  name: pkgName,
  version: "1.0.0",
  scripts: {
    compile: "hardhat compile",
    test: "hardhat test",
    deploy: "hardhat run scripts/deploy.js"
  },
  devDependencies: {
    hardhat: "^2.25.0",
    "@nomicfoundation/hardhat-toolbox": "^3.0.0",
    "@openzeppelin/contracts": "^5.4.0",
    dotenv: "^17.2.0"
  }
};
fs.writeFileSync(
  path.join(projectPath, "package.json"),
  JSON.stringify(packageJson, null, 2)
);

// contracts/Example.sol 생성
console.log("📦 contracts/Example.sol 생성 중...");
const exampleContract = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract Example {
    string public greet = "Hello from ${pkgName}!";
}
`;
fs.writeFileSync(path.join(projectPath, "contracts", "Example.sol"), exampleContract);

// hardhat.config.js 생성
/**
 * jhhong comments
 * defaultNetwork: "development", 을 명시하면 hardhat test 시 인메모리 임시노드를 띄우지 않고 외부 노드를 명시적으로 찾는다.
 * 그래서 다른창에 노드 안돌리고 하면 hardhat test 시 에러남
 * defaultNetwork: 을 명시했던 이유는 일반 script 파일 실행 시 --network 옵션을 안주려고 그랬던 거였음
 * - defaultNetwork: 명시하고 --network 옵션 안주면 defaultNetwork: 에 명시된 network으로 연결시도함
 */
console.log("📦 hardhat: hardhat.config.js 생성 중...");
const configContent = `
require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });

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
// execSync("pnpm install", { cwd: projectPath, stdio: "inherit" });
// 루트에서 현재 패키지만 설치
const repoRoot = path.resolve(__dirname);
execSync(
  `pnpm -w install --filter ${pkgName}`,
  { cwd: repoRoot, stdio: "inherit" }
);

console.log("📦 Foundry 유틸 설치 중 (forge-std)...");
execSync("forge install foundry-rs/forge-std", { // foundry 최신버전 (v.1.2.3) 부터는 no-commit 할 필요 없음
  cwd: projectPath,
  stdio: "inherit",
});
console.log("📦 Foundry 유틸 설치 중 (openzeppelin)...");
execSync("forge install OpenZeppelin/openzeppelin-contracts", { // foundry 최신버전 (v.1.2.3) 부터는 no-commit 할 필요 없음
  cwd: projectPath,
  stdio: "inherit",
});

// Git 캐시에서 lib 제거 (추적 방지)
console.log("🧹 Git에서 lib 디렉토리 추적 제거 중...");
try {
  execSync("git rm -r -f --cached lib/", {
    cwd: projectPath,
    stdio: "inherit"
  });
} catch (err) {
  console.warn("⚠️  git rm 실패: 이미 추적되지 않거나 git repo가 아닐 수 있습니다.");
}


console.log(`✅ Hardhat + Foundry 프로젝트 생성 완료: projects/${projectName}`);
