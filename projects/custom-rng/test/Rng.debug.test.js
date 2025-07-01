const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Rng Contract", function () {
    let rng;
    let main;
    let owner;
    let user1;
    let signer;
    let domain;
    let types;

    beforeEach(async function () {
        [owner, user1, signer] = await ethers.getSigners();

        const Main = await ethers.getContractFactory("Main");
        main = await Main.deploy();
        await main.waitForDeployment();

        const Rng = await ethers.getContractFactory("Rng");
        rng = await Rng.deploy(await main.getAddress(), signer.address);
        await rng.waitForDeployment();

        await main.setContracts([await rng.getAddress()]);

        domain = {
            name: "Custom-Rng",
            version: "1",
            chainId: await ethers.provider.getNetwork().then(net => net.chainId),
            verifyingContract: await rng.getAddress()
        };

        types = {
            SigData: [
                { name: "roundId", type: "uint256" },
                { name: "randSeed", type: "uint256" }
            ]
        };
    });

    describe("초기화", function () {
        it("올바른 주소로 초기화되어야 함", async function () {
            expect(await rng.mainAddr()).to.equal(await main.getAddress());
            expect(await rng.signerAddr()).to.equal(signer.address);
        });

        it("상수값이 올바르게 설정되어야 함", async function () {
            expect(await rng.ENTROPY_FACTOR1()).to.equal(6);
            expect(await rng.ENTROPY_FACTOR2()).to.equal(16);
        });

        it("잘못된 주소로 초기화하면 실패해야 함", async function () {
            const Rng = await ethers.getContractFactory("Rng");
            await expect(
                Rng.deploy(ethers.ZeroAddress, signer.address)
            ).to.be.revertedWith("Invalid Main address");

            await expect(
                Rng.deploy(await main.getAddress(), ethers.ZeroAddress)
            ).to.be.revertedWith("Invalid Signer address");
        });
    });

    describe("commit", function () {
        it("Main 컨트랙트만 호출할 수 있어야 함", async function () {
            const signature = "0x" + "1".repeat(130);
            await expect(
                rng.connect(user1).commit(1, signature)
            ).to.be.revertedWith("Not Main contract");
        });

        it("Main 컨트랙트를 통해 커밋이 성공해야 함", async function () {
            const signature = "0x" + "1".repeat(130);
            await expect(main.startRound(1, signature))
                .to.emit(rng, "Committed")
                .withArgs(1);

            const info = await rng.getRoundRngInfo(1);
            expect(info.signature).to.equal(signature);
        });

        it("이미 커밋된 라운드는 실패해야 함", async function () {
            const signature = "0x" + "1".repeat(130);
            await main.startRound(1, signature);

            await expect(
                main.startRound(1, signature)
            ).to.be.revertedWith("Round already started");
        });
    });

    describe("sealEntropy", function () {
        beforeEach(async function () {
            const signature = "0x" + "1".repeat(130);
            await main.startRound(1, signature);
        });

        it("Main 컨트랙트만 호출할 수 있어야 함", async function () {
            await expect(
                rng.connect(user1).sealEntropy(1, await user1.getAddress())
            ).to.be.revertedWith("Not Main contract");
        });

        it("Main 컨트랙트를 통해 sealEntropy가 성공해야 함", async function () {
            const tx = await main.connect(user1).endRound(1);
            await tx.wait();
            await expect(tx)
                .to.emit(rng, "SealedEntropy");

            const info = await rng.getRoundRngInfo(1);
            expect(info.ender).to.equal(await user1.getAddress());
            expect(info.blockTime).to.be.gt(0);
            expect(info.salt).to.not.equal(ethers.ZeroHash);
        });

        it("커밋되지 않은 라운드는 실패해야 함", async function () {
            await expect(
                main.connect(user1).endRound(2)
            ).to.be.revertedWith("Round not active");
        });

        it("이미 sealed된 라운드는 실패해야 함", async function () {
            await main.connect(user1).endRound(1);

            await expect(
                main.connect(user1).endRound(1)
            ).to.be.revertedWith("Round not active");
        });
    });

    describe("reveal", function () {
        let validSignature;
        let roundId = 1;
        let randSeed = 12345;

        beforeEach(async function () {
            const sigData = { roundId: roundId, randSeed: randSeed };
            validSignature = await signer.signTypedData(domain, types, sigData);

            await main.startRound(roundId, validSignature);
            await main.connect(user1).endRound(roundId);
        });

        it("Main 컨트랙트만 호출할 수 있어야 함", async function () {
            await expect(
                rng.connect(user1).reveal(roundId, randSeed)
            ).to.be.revertedWith("Not Main contract");
        });

        it("Main 컨트랙트를 통해 reveal이 성공해야 함", async function () {
            const tx = await main.settleRound(roundId, randSeed);
            await tx.wait();
            await expect(tx)
                .to.emit(rng, "Revealed");

            const info = await rng.getRoundRngInfo(roundId);
            expect(info.finalRands).to.not.equal(ethers.ZeroHash);
        });

        it("이미 revealed된 라운드는 실패해야 함", async function () {
            await main.settleRound(roundId, randSeed);

            await expect(
                main.settleRound(roundId, randSeed)
            ).to.be.revertedWith("Round not ready to settle");
        });

        it("잘못된 서명으로 실패해야 함", async function () {
            const wrongSignature = "0x" + "2".repeat(130);
            await main.startRound(3, wrongSignature);
            await main.connect(user1).endRound(3);

            await expect(
                main.settleRound(3, randSeed)
            ).to.be.revertedWith("RNG: reveal failed");
        });
    });

    // ... 이하 생략 가능
});
