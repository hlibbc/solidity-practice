const { spawn } = require('child_process');
const fs = require('fs');
const readline = require('readline');

class HardhatNodeManager {
  constructor() {
    this.nodeProcess = null;
    this.nodeVersion = null;
  }

  async waitForUserNode(version) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    console.log(`\n🚀 Hardhat 노드 ${version} 버전을 실행해주세요.`);
    console.log(`💡 새 터미널에서 다음 명령어를 실행하세요:`);
    
    if (version === '2.19.0') {
      console.log(`   cd nodes/hardhat-shanghai && npx hardhat node`);
    } else if (version === '2.22.0') {
      console.log(`   cd nodes/hardhat-cancun && npx hardhat node`);
    } else {
      console.log(`   npx hardhat node`);
    }
    
    console.log(`\n✅ 노드가 실행되면 엔터를 눌러주세요...`);
    
    return new Promise((resolve) => {
      rl.question('', () => {
        rl.close();
        console.log('✅ 사용자 노드 실행 확인됨!');
        this.nodeVersion = version;
        resolve();
      });
    });
  }

  async waitForUserStop() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    console.log(`\n🛑 현재 실행 중인 Hardhat 노드를 종료해주세요.`);
    console.log(`💡 노드가 실행 중인 터미널에서 Ctrl+C를 눌러주세요.`);
    console.log(`\n✅ 노드가 종료되면 엔터를 눌러주세요...`);
    
    return new Promise((resolve) => {
      rl.question('', () => {
        rl.close();
        console.log('✅ 노드 종료 확인됨!');
        this.nodeVersion = null;
        resolve();
      });
    });
  }

  async runTest(configFile, testName) {
    console.log(`\n🧪 테스트 실행: ${testName}`);
    console.log(`📁 설정 파일: ${configFile}`);
    
    // 설정 파일 복사
    fs.copyFileSync(configFile, 'hardhat.config.js');
    
    try {
      const result = await new Promise((resolve, reject) => {
        const testProcess = spawn('npx', ['hardhat', 'run', 'scripts/attack.js', '--network', 'localhost'], {
          stdio: 'pipe'
        });

        let output = '';
        
        testProcess.stdout.on('data', (data) => {
          output += data.toString();
        });

        testProcess.stderr.on('data', (data) => {
          output += data.toString();
        });

        testProcess.on('close', (code) => {
          resolve({ code, output });
        });

        testProcess.on('error', (error) => {
          reject(error);
        });
      });

      return this.analyzeResult(result);
      
    } catch (error) {
      return { success: false, result: 'ERROR', error: error.message };
    }
  }

  analyzeResult(result) {
    if (result.code !== 0) {
      if (result.output.includes('invalid opcode')) {
        return { success: false, result: 'INVALID_OPCODE' };
      } else if (result.output.includes('재배포 실패')) {
        return { success: false, result: 'REDEPLOY_FAILED' };
      } else {
        return { success: false, result: 'UNKNOWN_ERROR' };
      }
    } else {
      if (result.output.includes('isPassed: true')) {
        return { success: true, result: 'SUCCESS' };
      } else if (result.output.includes('재배포 실패')) {
        return { success: false, result: 'REDEPLOY_FAILED' };
      } else {
        return { success: false, result: 'UNKNOWN' };
      }
    }
  }
}

async function runAllScenarios() {
  const manager = new HardhatNodeManager();
  
  const scenarios = [
    {
      name: "Shanghai Node + Shanghai Compile",
      nodeVersion: "2.19.0",
      configFile: "hardhat.config.shanghai.js",
      expectedResult: "SUCCESS"
    },
    {
      name: "Shanghai Node + Cancun Compile", 
      nodeVersion: "2.19.0",
      configFile: "hardhat.config.cancun.js",
      expectedResult: "INVALID_OPCODE"
    },
    {
      name: "Cancun Node + Shanghai Compile",
      nodeVersion: "2.22.0", 
      configFile: "hardhat.config.shanghai.js",
      expectedResult: "REDEPLOY_FAILED"
    },
    {
      name: "Cancun Node + Cancun Compile",
      nodeVersion: "2.22.0",
      configFile: "hardhat.config.cancun.js", 
      expectedResult: "REDEPLOY_FAILED"
    }
  ];

  console.log("🚀 CREATE2 Selfdestruct 공격 시나리오 테스트");
  console.log("=" * 60);

  const results = [];

  for (let i = 0; i < scenarios.length; i++) {
    const scenario = scenarios[i];
    console.log(`\n🧪 테스트 시나리오: ${scenario.name}`);
    console.log(`📋 예상 결과: ${scenario.expectedResult}`);
    console.log("=" * 50);

    try {
      // 사용자에게 노드 실행 요청
      await manager.waitForUserNode(scenario.nodeVersion);
      
      // 테스트 실행
      const testResult = await manager.runTest(scenario.configFile, scenario.name);
      
      console.log(`✅ 실제 결과: ${testResult.result}`);
      
      // 예상 결과와 비교
      const isExpected = testResult.result === scenario.expectedResult;
      console.log(`🎯 ${isExpected ? "✅ 예상한 결과" : "❌ 예상과 다름"}`);
      
      results.push({
        scenario,
        actualResult: testResult.result,
        expectedResult: scenario.expectedResult,
        match: isExpected
      });

      // 다음 시나리오 전에 노드 종료 요청
      if (i < scenarios.length - 1) {
        await manager.waitForUserStop();
      }

    } catch (error) {
      console.log(`❌ 테스트 실패: ${error.message}`);
      results.push({
        scenario,
        actualResult: "ERROR",
        expectedResult: scenario.expectedResult,
        match: false
      });
    }
  }

  // 마지막 노드 종료 요청
  await manager.waitForUserStop();

  // 결과 요약
  console.log("\n📊 최종 결과 요약");
  console.log("=" * 60);
  
  results.forEach((result, index) => {
    const status = result.match ? "✅" : "❌";
    console.log(`${status} ${index + 1}. ${result.scenario.name}`);
    console.log(`   예상: ${result.expectedResult} | 실제: ${result.actualResult}`);
  });
  
  const successCount = results.filter(r => r.match).length;
  console.log(`\n🎯 성공률: ${successCount}/${results.length} (${(successCount/results.length*100).toFixed(1)}%)`);
}

// 단일 시나리오 실행
async function runSingleScenario(nodeVersion, configFile, testName) {
  const manager = new HardhatNodeManager();
  
  try {
    console.log(`🧪 단일 테스트: ${testName}`);
    console.log(`🚀 노드 버전: ${nodeVersion}`);
    
    await manager.startNode(nodeVersion);
    const result = await manager.runTest(configFile, testName);
    
    console.log(`✅ 결과: ${result.result}`);
    
    await manager.stopNode();
    return result;
    
  } catch (error) {
    console.error(`❌ 테스트 실패: ${error.message}`);
    await manager.stopNode();
    throw error;
  }
}

// CLI 인자 처리
const args = process.argv.slice(2);
if (args.length === 0) {
  runAllScenarios().catch(console.error);
} else if (args.length === 3) {
  const [nodeVersion, configFile, testName] = args;
  runSingleScenario(nodeVersion, configFile, testName).catch(console.error);
} else {
  console.log("사용법:");
  console.log("  node scripts/run-with-node.js                    # 모든 시나리오 실행");
  console.log("  node scripts/run-with-node.js 2.19.0 hardhat.config.shanghai.js 'Shanghai Test'  # 단일 테스트");
} 