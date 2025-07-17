const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Main + Rng Integration", function () {
    let main;
    let rng;
    let owner;
    let user1;
    let user2;
    let signer;
    let domain;
    let types;

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

        // EIP-712 도메인 설정
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

    describe("전체 시스템 라이프사이클", function () {
        it("완전한 라운드 라이프사이가 성공해야 함", async function () {
            const roundId = 1;
            const randSeed = 12345;

            // 1. EIP-712 서명 생성
            const sigData = { roundId: roundId, randSeed: randSeed };
            const signature = await signer.signTypedData(domain, types, sigData);

            // 2. 라운드 시작 (commit)
            await expect(main.startRound(roundId, signature))
                .to.emit(main, "RoundStarted")
                .withArgs(roundId);

            expect(await main.getRoundStatus(roundId)).to.equal(1); // Proceeding

            // 3. 라운드 종료 (sealEntropy)
            await expect(main.connect(user1).endRound(roundId))
                .to.emit(main, "RoundEnded")
                .withArgs(roundId, await user1.getAddress());

            expect(await main.getRoundStatus(roundId)).to.equal(2); // Drawing

            // 4. 라운드 정산 (reveal)
            await expect(main.settleRound(roundId, randSeed))
                .to.emit(main, "RoundSettled")
                .withArgs(roundId);

            expect(await main.getRoundStatus(roundId)).to.equal(3); // Claiming

            // 5. 최종 결과 확인
            const roundInfo = await main.roundManageInfo(roundId);
            expect(roundInfo.status).to.equal(3); // Claiming
            expect(roundInfo.endedAt).to.be.gt(0);
            expect(roundInfo.settledAt).to.be.gt(0);

            const rngInfo = await rng.getRoundRngInfo(roundId);
            expect(rngInfo.ender).to.equal(await user1.getAddress());
            expect(rngInfo.blockTime).to.be.gt(0);
            expect(rngInfo.salt).to.not.equal(ethers.ZeroHash);
            expect(rngInfo.finalRands).to.not.equal(ethers.ZeroHash);
            expect(rngInfo.signature).to.equal(signature);
        });

        it("여러 라운드가 독립적으로 동작해야 함", async function () {
            const roundId1 = 1;
            const roundId2 = 2;
            const randSeed = 12345;

            // 첫 번째 라운드
            const sigData1 = { roundId: roundId1, randSeed: randSeed };
            const signature1 = await signer.signTypedData(domain, types, sigData1);

            await main.startRound(roundId1, signature1);
            await main.connect(user1).endRound(roundId1);
            await main.settleRound(roundId1, randSeed);

            // 두 번째 라운드
            const sigData2 = { roundId: roundId2, randSeed: randSeed };
            const signature2 = await signer.signTypedData(domain, types, sigData2);

            await main.startRound(roundId2, signature2);
            await main.connect(user2).endRound(roundId2);
            await main.settleRound(roundId2, randSeed);

            // 각 라운드가 독립적으로 완료되었는지 확인
            expect(await main.getRoundStatus(roundId1)).to.equal(3); // Claiming
            expect(await main.getRoundStatus(roundId2)).to.equal(3); // Claiming

            const rngInfo1 = await rng.getRoundRngInfo(roundId1);
            const rngInfo2 = await rng.getRoundRngInfo(roundId2);

            expect(rngInfo1.ender).to.equal(await user1.getAddress());
            expect(rngInfo2.ender).to.equal(await user2.getAddress());
            expect(rngInfo1.finalRands).to.not.equal(rngInfo2.finalRands);
        });
    });

    describe("권한 검증", function () {
        it("소유자가 아닌 사용자는 라운드를 시작할 수 없어야 함", async function () {
            const roundId = 1;
            const randSeed = 12345;
            const sigData = { roundId: roundId, randSeed: randSeed };
            const signature = await signer.signTypedData(domain, types, sigData);

            await expect(
                main.connect(user1).startRound(roundId, signature)
            ).to.be.revertedWithCustomError(main, "OwnableUnauthorizedAccount");
        });

        it("소유자가 아닌 사용자는 라운드를 정산할 수 없어야 함", async function () {
            const roundId = 1;
            const randSeed = 12345;
            const sigData = { roundId: roundId, randSeed: randSeed };
            const signature = await signer.signTypedData(domain, types, sigData);

            await main.startRound(roundId, signature);
            await main.connect(user1).endRound(roundId);

            await expect(
                main.connect(user1).settleRound(roundId, randSeed)
            ).to.be.revertedWithCustomError(main, "OwnableUnauthorizedAccount");
        });

        it("누구나 라운드를 종료할 수 있어야 함", async function () {
            const roundId = 1;
            const randSeed = 12345;
            const sigData = { roundId: roundId, randSeed: randSeed };
            const signature = await signer.signTypedData(domain, types, sigData);

            await main.startRound(roundId, signature);

            // user1이 종료
            await expect(main.connect(user1).endRound(roundId))
                .to.emit(main, "RoundEnded")
                .withArgs(roundId, await user1.getAddress());

            // user2도 종료 가능 (다른 라운드)
            await main.startRound(roundId + 1, signature);
            await expect(main.connect(user2).endRound(roundId + 1))
                .to.emit(main, "RoundEnded")
                .withArgs(roundId + 1, await user2.getAddress());
        });
    });

    describe("상태 전이 검증", function () {
        it("잘못된 순서로 함수를 호출하면 실패해야 함", async function () {
            const roundId = 1;
            const randSeed = 12345;
            const sigData = { roundId: roundId, randSeed: randSeed };
            const signature = await signer.signTypedData(domain, types, sigData);

            // 라운드 시작 전에 종료 시도
            await expect(
                main.connect(user1).endRound(roundId)
            ).to.be.revertedWith("Round not active");

            // 라운드 시작
            await main.startRound(roundId, signature);

            // 라운드 종료 전에 정산 시도
            await expect(
                main.settleRound(roundId, randSeed)
            ).to.be.revertedWith("Round not ready to settle");

            // 라운드 종료
            await main.connect(user1).endRound(roundId);

            // 정산
            await main.settleRound(roundId, randSeed);

            // 이미 완료된 라운드에 대한 추가 작업 시도
            await expect(
                main.connect(user1).endRound(roundId)
            ).to.be.revertedWith("Round not active");
        });

        it("라운드 상태가 올바르게 전이되어야 함", async function () {
            const roundId = 1;
            const randSeed = 12345;
            const sigData = { roundId: roundId, randSeed: randSeed };
            const signature = await signer.signTypedData(domain, types, sigData);

            // 시작 전: NotStarted
            expect(await main.getRoundStatus(roundId)).to.equal(0);

            // 시작 후: Proceeding
            await main.startRound(roundId, signature);
            expect(await main.getRoundStatus(roundId)).to.equal(1);

            // 종료 후: Drawing
            await main.connect(user1).endRound(roundId);
            expect(await main.getRoundStatus(roundId)).to.equal(2);

            // 정산 후: Claiming
            await main.settleRound(roundId, randSeed);
            expect(await main.getRoundStatus(roundId)).to.equal(3);
        });
    });

    describe("EIP-712 서명 검증", function () {
        it("올바른 서명으로 라운드가 성공해야 함", async function () {
            const roundId = 1;
            const randSeed = 12345;
            const sigData = { roundId: roundId, randSeed: randSeed };
            const signature = await signer.signTypedData(domain, types, sigData);

            await main.startRound(roundId, signature);
            await main.connect(user1).endRound(roundId);
            await main.settleRound(roundId, randSeed);

            const rngInfo = await rng.getRoundRngInfo(roundId);
            expect(rngInfo.finalRands).to.not.equal(ethers.ZeroHash);
        });

        it("잘못된 서명으로 라운드가 실패해야 함", async function () {
            const roundId = 1;
            const randSeed = 12345;
            const sigData = { roundId: roundId, randSeed: randSeed };
            
            // user1이 서명 (signer가 아님)
            const signature = await user1.signTypedData(domain, types, sigData);

            await main.startRound(roundId, signature);
            await main.connect(user1).endRound(roundId);
            
            // reveal에서 서명 검증 실패
            await expect(
                main.settleRound(roundId, randSeed)
            ).to.be.revertedWith("RNG: reveal failed");
        });

        it("잘못된 시드로 라운드가 실패해야 함", async function () {
            const roundId = 1;
            const randSeed = 12345;
            const wrongSeed = 54321;
            const sigData = { roundId: roundId, randSeed: randSeed };
            const signature = await signer.signTypedData(domain, types, sigData);

            await main.startRound(roundId, signature);
            await main.connect(user1).endRound(roundId);
            
            // 잘못된 시드로 reveal 시도
            await expect(
                main.settleRound(roundId, wrongSeed)
            ).to.be.revertedWith("RNG: reveal failed");
        });
    });

    describe("난수 생성 검증", function () {
        it("같은 시드라도 다른 난수가 생성되어야 함", async function () {
            const roundId1 = 1;
            const roundId2 = 2;
            const randSeed = 12345;

            // 첫 번째 라운드
            const sigData1 = { roundId: roundId1, randSeed: randSeed };
            const signature1 = await signer.signTypedData(domain, types, sigData1);

            await main.startRound(roundId1, signature1);
            await main.connect(user1).endRound(roundId1);
            await main.settleRound(roundId1, randSeed);

            // 블록을 몇 개 더 생성
            await ethers.provider.send("evm_mine");
            await ethers.provider.send("evm_mine");

            // 두 번째 라운드
            const sigData2 = { roundId: roundId2, randSeed: randSeed };
            const signature2 = await signer.signTypedData(domain, types, sigData2);

            await main.startRound(roundId2, signature2);
            await main.connect(user1).endRound(roundId2);
            await main.settleRound(roundId2, randSeed);

            const rngInfo1 = await rng.getRoundRngInfo(roundId1);
            const rngInfo2 = await rng.getRoundRngInfo(roundId2);

            // 같은 시드라도 다른 난수가 생성되어야 함
            expect(rngInfo1.finalRands).to.not.equal(rngInfo2.finalRands);
        });

        it("다른 ender로 다른 난수가 생성되어야 함", async function () {
            const roundId1 = 1;
            const roundId2 = 2;
            const randSeed = 12345;

            // 첫 번째 라운드 (user1이 ender)
            const sigData1 = { roundId: roundId1, randSeed: randSeed };
            const signature1 = await signer.signTypedData(domain, types, sigData1);

            await main.startRound(roundId1, signature1);
            await main.connect(user1).endRound(roundId1);
            await main.settleRound(roundId1, randSeed);

            // 두 번째 라운드 (user2가 ender)
            const sigData2 = { roundId: roundId2, randSeed: randSeed };
            const signature2 = await signer.signTypedData(domain, types, sigData2);

            await main.startRound(roundId2, signature2);
            await main.connect(user2).endRound(roundId2);
            await main.settleRound(roundId2, randSeed);

            const rngInfo1 = await rng.getRoundRngInfo(roundId1);
            const rngInfo2 = await rng.getRoundRngInfo(roundId2);

            // 다른 ender로 다른 난수가 생성되어야 함
            expect(rngInfo1.finalRands).to.not.equal(rngInfo2.finalRands);
        });
    });

    describe("이벤트 검증", function () {
        it("모든 이벤트가 올바르게 발생해야 함", async function () {
            const roundId = 1;
            const randSeed = 12345;
            const sigData = { roundId: roundId, randSeed: randSeed };
            const signature = await signer.signTypedData(domain, types, sigData);

            // RoundStarted 이벤트
            await expect(main.startRound(roundId, signature))
                .to.emit(main, "RoundStarted")
                .withArgs(roundId)
                .and.to.emit(rng, "Committed")
                .withArgs(roundId);

            // RoundEnded 이벤트
            await expect(main.connect(user1).endRound(roundId))
                .to.emit(main, "RoundEnded")
                .withArgs(roundId, await user1.getAddress())
                .and.to.emit(rng, "SealedEntropy");

            // RoundSettled 이벤트
            await expect(main.settleRound(roundId, randSeed))
                .to.emit(main, "RoundSettled")
                .withArgs(roundId)
                .and.to.emit(rng, "Revealed");
        });
    });

    describe("에러 처리", function () {
        it("존재하지 않는 라운드에 대한 조회가 올바르게 처리되어야 함", async function () {
            const nonExistentRound = 999;
            
            expect(await main.getRoundStatus(nonExistentRound)).to.equal(0); // NotStarted
            
            const rngInfo = await rng.getRoundRngInfo(nonExistentRound);
            expect(rngInfo.ender).to.equal(ethers.ZeroAddress);
            expect(rngInfo.blockTime).to.equal(0);
            expect(rngInfo.salt).to.equal(ethers.ZeroHash);
            expect(rngInfo.finalRands).to.equal(ethers.ZeroHash);
            expect(rngInfo.signature).to.equal("0x");
        });

        it("중복 작업 시도가 올바르게 처리되어야 함", async function () {
            const roundId = 1;
            const randSeed = 12345;
            const sigData = { roundId: roundId, randSeed: randSeed };
            const signature = await signer.signTypedData(domain, types, sigData);

            // 라운드 시작
            await main.startRound(roundId, signature);
            
            // 중복 시작 시도
            await expect(
                main.startRound(roundId, signature)
            ).to.be.revertedWith("Round already started");

            // 라운드 종료
            await main.connect(user1).endRound(roundId);
            
            // 중복 종료 시도
            await expect(
                main.connect(user1).endRound(roundId)
            ).to.be.revertedWith("Round not active");

            // 라운드 정산
            await main.settleRound(roundId, randSeed);
            
            // 중복 정산 시도
            await expect(
                main.settleRound(roundId, randSeed)
            ).to.be.revertedWith("Round not ready to settle");
        });
    });
}); 