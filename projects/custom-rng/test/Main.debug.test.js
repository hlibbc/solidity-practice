const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Main Contract", function () {
    let main;
    let rng;
    let owner;
    let user1;
    let user2;
    let signer;

    beforeEach(async function () {
        [owner, user1, user2, signer] = await ethers.getSigners();

        // Main 컨트랙트 배포
        const Main = await ethers.getContractFactory("Main");
        main = await Main.deploy();
        await main.waitForDeployment();

        // Rng 컨트랙트 배포
        const Rng = await ethers.getContractFactory("Rng");
        rng = await Rng.deploy(await main.getAddress(), signer.address);
        await rng.waitForDeployment();

        // Main 컨트랙트에 Rng 컨트랙트 주소 설정
        await main.setContracts([await rng.getAddress()]);
    });

    describe("초기화", function () {
        it("올바른 소유자로 초기화되어야 함", async function () {
            expect(await main.owner()).to.equal(owner.address);
        });

        it("초기 라운드 상태가 NotStarted여야 함", async function () {
            expect(await main.getRoundStatus(1)).to.equal(0); // NotStarted
        });

        it("컨트랙트 주소가 올바르게 설정되어야 함", async function () {
            expect(await main.managedContracts(0)).to.equal(await rng.getAddress());
        });
    });

    describe("setContracts", function () {
        it("소유자만 컨트랙트 주소를 설정할 수 있어야 함", async function () {
            await expect(
                main.connect(user1).setContracts([await rng.getAddress()])
            ).to.be.revertedWithCustomError(main, "OwnableUnauthorizedAccount");
        });

        it("잘못된 컨트랙트 개수로 설정하면 실패해야 함", async function () {
                    await expect(
            main.setContracts([await rng.getAddress(), await user1.getAddress()])
        ).to.be.revertedWith("Incorrect Contract Nums");
        });
    });

    describe("startRound", function () {
        it("소유자만 라운드를 시작할 수 있어야 함", async function () {
            const signature = "0x" + "1".repeat(130);
            await expect(
                main.connect(user1).startRound(1, signature)
            ).to.be.revertedWithCustomError(main, "OwnableUnauthorizedAccount");
        });

        it("라운드가 이미 시작된 경우 실패해야 함", async function () {
            const signature = "0x" + "1".repeat(130);
            await main.startRound(1, signature);
            
            await expect(
                main.startRound(1, signature)
            ).to.be.revertedWith("Round already started");
        });

        it("라운드 시작이 성공해야 함", async function () {
            const signature = "0x" + "1".repeat(130);
            await expect(main.startRound(1, signature))
                .to.emit(main, "RoundStarted")
                .withArgs(1);

            expect(await main.getRoundStatus(1)).to.equal(1); // Proceeding
        });
    });

    describe("endRound", function () {
        beforeEach(async function () {
            const signature = "0x" + "1".repeat(130);
            await main.startRound(1, signature);
        });

        it("누구나 라운드를 종료할 수 있어야 함", async function () {
            await expect(main.connect(user1).endRound(1))
                .to.emit(main, "RoundEnded")
                .withArgs(1, await user1.getAddress());

            expect(await main.getRoundStatus(1)).to.equal(2); // Drawing
        });

        it("라운드가 진행중이 아닌 경우 실패해야 함", async function () {
            await main.connect(user1).endRound(1);
            
            await expect(
                main.endRound(1)
            ).to.be.revertedWith("Round not active");
        });

        it("라운드 종료 시 종료 시간이 기록되어야 함", async function () {
            const tx = await main.connect(user1).endRound(1);
            const receipt = await tx.wait();
            const block = await ethers.provider.getBlock(receipt.blockNumber);
            
            const roundInfo = await main.roundManageInfo(1);
            expect(roundInfo.endedAt).to.equal(block.timestamp);
        });
    });

    describe("settleRound", function () {
        beforeEach(async function () {
            const signature = "0x" + "1".repeat(130);
            await main.startRound(1, signature);
            await main.connect(user1).endRound(1);
        });

        it("소유자만 라운드를 정산할 수 있어야 함", async function () {
            await expect(
                main.connect(user1).settleRound(1, 12345)
            ).to.be.revertedWithCustomError(main, "OwnableUnauthorizedAccount");
        });

        it("라운드가 개표중이 아닌 경우 실패해야 함", async function () {
            const signature = "0x" + "1".repeat(130);
            await main.startRound(2, signature);
            
            await expect(
                main.settleRound(2, 12345)
            ).to.be.revertedWith("Round not ready to settle");
        });

        it("라운드 정산이 성공해야 함", async function () {
            // 유효한 EIP-712 서명 생성
            const domain = {
                name: "Custom-Rng",
                version: "1",
                chainId: await ethers.provider.getNetwork().then(net => net.chainId),
                verifyingContract: await rng.getAddress()
            };

            const types = {
                SigData: [
                    { name: "roundId", type: "uint256" },
                    { name: "randSeed", type: "uint256" }
                ]
            };

            const sigData = { roundId: 5, randSeed: 12345 };
            const signature = await signer.signTypedData(domain, types, sigData);

            await main.startRound(5, signature);
            await main.connect(user1).endRound(5);

            await expect(main.settleRound(5, 12345))
                .to.emit(main, "RoundSettled")
                .withArgs(5);

            expect(await main.getRoundStatus(5)).to.equal(3); // Claiming
        });

        it("라운드 정산 시 정산 시간이 기록되어야 함", async function () {
            // 유효한 EIP-712 서명 생성
            const domain = {
                name: "Custom-Rng",
                version: "1",
                chainId: await ethers.provider.getNetwork().then(net => net.chainId),
                verifyingContract: await rng.getAddress()
            };

            const types = {
                SigData: [
                    { name: "roundId", type: "uint256" },
                    { name: "randSeed", type: "uint256" }
                ]
            };

            const sigData = { roundId: 2, randSeed: 12345 };
            const signature = await signer.signTypedData(domain, types, sigData);

            await main.startRound(2, signature);
            await main.connect(user1).endRound(2);

            const tx = await main.settleRound(2, 12345);
            const receipt = await tx.wait();
            const block = await ethers.provider.getBlock(receipt.blockNumber);
            
            const roundInfo = await main.roundManageInfo(2);
            expect(roundInfo.settledAt).to.equal(block.timestamp);
        });
    });

    describe("getRoundStatus", function () {
        it("존재하지 않는 라운드는 NotStarted 상태를 반환해야 함", async function () {
            expect(await main.getRoundStatus(999)).to.equal(0); // NotStarted
        });

        it("라운드 상태가 올바르게 반환되어야 함", async function () {
            // 유효한 EIP-712 서명 생성
            const domain = {
                name: "Custom-Rng",
                version: "1",
                chainId: await ethers.provider.getNetwork().then(net => net.chainId),
                verifyingContract: await rng.getAddress()
            };

            const types = {
                SigData: [
                    { name: "roundId", type: "uint256" },
                    { name: "randSeed", type: "uint256" }
                ]
            };

            const sigData = { roundId: 3, randSeed: 12345 };
            const signature = await signer.signTypedData(domain, types, sigData);
            
            // 시작 전
            expect(await main.getRoundStatus(3)).to.equal(0); // NotStarted
            
            // 시작 후
            await main.startRound(3, signature);
            expect(await main.getRoundStatus(3)).to.equal(1); // Proceeding
            
            // 종료 후
            await main.connect(user1).endRound(3);
            expect(await main.getRoundStatus(3)).to.equal(2); // Drawing
            
            // 정산 후
            await main.settleRound(3, 12345);
            expect(await main.getRoundStatus(3)).to.equal(3); // Claiming
        });
    });

    describe("라운드 라이프사이클 통합 테스트", function () {
        it("전체 라운드 라이프사이가 올바르게 동작해야 함", async function () {
            // 유효한 EIP-712 서명 생성
            const domain = {
                name: "Custom-Rng",
                version: "1",
                chainId: await ethers.provider.getNetwork().then(net => net.chainId),
                verifyingContract: await rng.getAddress()
            };

            const types = {
                SigData: [
                    { name: "roundId", type: "uint256" },
                    { name: "randSeed", type: "uint256" }
                ]
            };

            const sigData = { roundId: 4, randSeed: 12345 };
            const signature = await signer.signTypedData(domain, types, sigData);
            
            // 1. 라운드 시작
            await expect(main.startRound(4, signature))
                .to.emit(main, "RoundStarted")
                .withArgs(4);
            
            // 2. 라운드 종료
            await expect(main.connect(user1).endRound(4))
                .to.emit(main, "RoundEnded")
                .withArgs(4, await user1.getAddress());
            
            // 3. 라운드 정산
            await expect(main.settleRound(4, 12345))
                .to.emit(main, "RoundSettled")
                .withArgs(4);
            
            // 4. 최종 상태 확인
            const roundInfo = await main.roundManageInfo(4);
            expect(roundInfo.status).to.equal(3); // Claiming
            expect(roundInfo.endedAt).to.be.gt(0);
            expect(roundInfo.settledAt).to.be.gt(0);
        });
    });
}); 