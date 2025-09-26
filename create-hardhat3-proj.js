/**
 * @file create-hardhat3-proj.js
 * @fileoverview Create a sub solidity project (Hardhat v3 + Viem toolbox, Ignition-only, TS, Verify/Keystore enabled).
 * @usage node create-hardhat3-proj.js <projectName>
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const projectName = process.argv[2];
const pkgName = projectName.split("/").pop(); // 프로젝트 내 서브프로젝트 식별 (ex. zk-playground/zk-01_basic-arithmetic)

if (!projectName) {
    console.error("❌ 프로젝트 이름을 인자로 넘겨주세요. 예: node create-hardhat3-proj.js hardhat3-test");
    process.exit(1);
}

const basePath = path.join(__dirname, "projects");
const projectPath = path.join(basePath, projectName);

if (fs.existsSync(projectPath)) {
    console.error(`❌ ${projectName} 폴더가 이미 존재합니다.`);
    process.exit(1);
}

// ──────────────────────────────────────────────────────────────────────────────
// 폴더 구조 생성
// ──────────────────────────────────────────────────────────────────────────────
fs.mkdirSync(projectPath, { recursive: true });
fs.mkdirSync(path.join(projectPath, "contracts"));
fs.mkdirSync(path.join(projectPath, "test"));
fs.mkdirSync(path.join(projectPath, "foundry", "test"), { recursive: true });
fs.mkdirSync(path.join(projectPath, "lib")); // forge install용
fs.mkdirSync(path.join(projectPath, "ignition", "modules"), { recursive: true });

// ──────────────────────────────────────────────────────────────────────────────
console.log("📦 package.json 생성 중...");
// Hardhat 3 + Viem + Ignition + Verify + Keystore + TS
const packageJson = {
    name: projectName,
    version: "1.0.0",
    private: true,
    type: "module",
    scripts: {
        compile: "hardhat compile",
        build: "hardhat build",
        test: "hardhat test",
        typecheck: "tsc --noEmit",
        deploy: "hardhat ignition deploy ignition/modules/Example.ts",
        "deploy:dev": "hardhat ignition deploy ignition/modules/Example.ts --network development",
        "deploy:reset": "hardhat ignition deploy ignition/modules/Example.ts --network development --reset"
    },
    devDependencies: {
        "hardhat": "^3.0.4",
        "@nomicfoundation/hardhat-toolbox-viem": "^5.0.0",
        "@nomicfoundation/hardhat-network-helpers": "^3.0.0",
        "@nomicfoundation/hardhat-ignition": "^3.0.2",
        "@nomicfoundation/hardhat-ignition-viem": "^3.0.2",
        "@nomicfoundation/hardhat-verify": "^3.0.0",
        "@nomicfoundation/hardhat-keystore": "^3.0.0",
        "viem": "^2.37.3",
        "typescript": "~5.8.0",
        "@types/node": "^22.18.1",
        "@openzeppelin/contracts": "^5.4.0",
        "dotenv": "^17.2.2"
    }
};
fs.writeFileSync(path.join(projectPath, "package.json"), JSON.stringify(packageJson, null, 4));

// ──────────────────────────────────────────────────────────────────────────────
console.log("📦 tsconfig.json 생성 중...");
const tsconfig = {
    "compilerOptions": {
        "target": "ES2022",
        "module": "NodeNext",
        "moduleResolution": "NodeNext",
        "strict": true,
        "resolveJsonModule": true,
        "types": ["node"],
        "skipLibCheck": true
    },
    "include": ["hardhat.config.ts", "ignition/**/*.ts", "test/**/*.ts", "scripts/**/*.ts"]
};
fs.writeFileSync(path.join(projectPath, "tsconfig.json"), JSON.stringify(tsconfig, null, 2));

// ──────────────────────────────────────────────────────────────────────────────
console.log("📦 contracts/Example.sol 생성 중...");
const exampleContract = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract Example {
    string public greet = "Hello from ${projectName}!";
}
`;
fs.writeFileSync(path.join(projectPath, "contracts", "Example.sol"), exampleContract);

// ──────────────────────────────────────────────────────────────────────────────
console.log("📦 ignition/modules/Example.ts 생성 중...");
const ignitionModule = `import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("ExampleModule", (m) => {
  const example = m.contract("Example", []);
  return { example };
});
`;
fs.writeFileSync(path.join(projectPath, "ignition", "modules", "Example.ts"), ignitionModule);

// ──────────────────────────────────────────────────────────────────────────────
console.log("📦 hardhat: hardhat.config.ts 생성 중...");
const configContent = `import { configVariable, HardhatUserConfig } from "hardhat/config";
import toolboxViem from "@nomicfoundation/hardhat-toolbox-viem";
import hardhatKeystore from "@nomicfoundation/hardhat-keystore";
import hardhatVerify from "@nomicfoundation/hardhat-verify";

const config: HardhatUserConfig = {
  plugins: [toolboxViem, hardhatKeystore, hardhatVerify],
  solidity: {
    version: "0.8.28",
    settings: {
      // evmVersion: "cancun",
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
`;
fs.writeFileSync(path.join(projectPath, "hardhat.config.ts"), configContent);

// ──────────────────────────────────────────────────────────────────────────────
console.log("📦 foundry: foundry.toml 생성 중...");
const foundryToml = `[profile.default]
src = "contracts"
test = "foundry/test"
out = "foundry/out"
libs = ["lib"]
auto_detect_remappings = true
`;
fs.writeFileSync(path.join(projectPath, "foundry.toml"), foundryToml);

// ──────────────────────────────────────────────────────────────────────────────
console.log("📦 foundry: remappings.txt 생성 중...");
fs.writeFileSync(
    path.join(projectPath, "remappings.txt"),
    ["@contracts/=contracts/", "@lib/=lib/", "@openzeppelin/=lib/openzeppelin-contracts/"].join("\n")
);

// ──────────────────────────────────────────────────────────────────────────────
console.log("📦 의존성 설치 중 (pnpm install)...");
// execSync("pnpm install", { cwd: projectPath, stdio: "inherit" });
// 루트에서 현재 패키지만 설치
const repoRoot = path.resolve(__dirname);
execSync(
  `pnpm -w install --filter ${pkgName}`,
  { cwd: repoRoot, stdio: "inherit" }
);

// ──────────────────────────────────────────────────────────────────────────────
// Foundry 라이브러리 설치 (버전 고정 권장)
console.log("📦 Foundry 유틸 설치 중 (forge-std v1.9.4)...");
execSync("forge install foundry-rs/forge-std@v1.9.4", { cwd: projectPath, stdio: "inherit" });

console.log("📦 Foundry 유틸 설치 중 (openzeppelin v5.4.0)...");
execSync("forge install OpenZeppelin/openzeppelin-contracts@v5.4.0", { cwd: projectPath, stdio: "inherit" });

// ──────────────────────────────────────────────────────────────────────────────
console.log("🧹 Git에서 lib 디렉토리 추적 제거 중...");
try {
    execSync("git rm -r -f --cached lib/", { cwd: projectPath, stdio: "inherit" });
} catch (err) {
    console.warn("⚠️  git rm 실패: 이미 추적되지 않았거나 git repo가 아닐 수 있습니다.");
}

console.log(`✅ Hardhat 3 + Viem + Ignition + Verify/Keystore + Foundry (TS) 프로젝트 생성 완료: projects/${projectName}`);
