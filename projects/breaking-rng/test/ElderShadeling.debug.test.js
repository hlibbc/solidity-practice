// tests/ElderShadeling.test.js
const { expect } = require("chai");
const { ethers, network } = require("hardhat");

describe("ElderShadeling", function () {
    let ElderShadeling, elder, deployer;

    beforeEach(async function () {
        [deployer] = await ethers.getSigners();
        ElderShadeling = await ethers.getContractFactory("ElderShadeling");
        elder = await ElderShadeling.deploy();
        await elder.waitForDeployment();
    });

    it("256 블록 이후에 blockhash가 0이 되어 isPredicted가 true가 되는지 확인", async function () {
        // 1) commitPrediction에 0x00...00을 커밋
        const zeroBytes32 = "0x" + "00".repeat(32);
        await elder.connect(deployer).commitPrediction(zeroBytes32);

        // 블록 넘버 기록
        const commitBlock = await ethers.provider.getBlockNumber();

        // 2) Hardhat 네트워크에서 블록을 257개 채굴 (mine) → blockNumber + 1이 256블록보다 과거가 되도록
        //    -- Hardhat에서는 `hardhat_mine` RPC를 사용해 블록을 빠르게 미리 채굴할 수 있음.
        //    -- 257개를 채굴해야 (커밋 블록 다음 블록도 포함하여) 최소 256블록 이전으로 밀림
        await network.provider.send("hardhat_mine", ["0x101"]); // 0x101 = 257 in hex

        // (선택사항) 현재 블록 번호가 commitBlock + 257이 되었는지 확인
        const afterMineBlock = await ethers.provider.getBlockNumber();
        expect(afterMineBlock).to.be.gte(commitBlock + 257);

        // 3) 이제 checkPrediction 호출
        await elder.connect(deployer).checkPrediction();

        // 4) isPredicted가 true로 바뀌었는지 확인
        expect(await elder.isPredicted()).to.equal(true);
    });
});
