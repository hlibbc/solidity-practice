// test/vesting.buy.errors.test.js
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { deployFixture } = require("./helpers/vestingFixture");

const ONE_USDT = 10n ** 6n;
const ZERO_HASH = ethers.ZeroHash;

function makePermit(value, deadline = 0n, v = 0, r = ZERO_HASH, s = ZERO_HASH) {
    return { value, deadline, v, r, s };
}

async function signPermit(ownerSigner, stableCoin, vesting, value, deadlineSeconds, overrideOwnerAddr) {
    const chainId = Number((await ethers.provider.getNetwork()).chainId);
    const domain = {
        name: await stableCoin.name(),
        version: "1",
        chainId,
        verifyingContract: await stableCoin.getAddress(),
    };
    const types = {
        Permit: [
            { name: "owner",    type: "address" },
            { name: "spender",  type: "address" },
            { name: "value",    type: "uint256" },
            { name: "nonce",    type: "uint256" },
            { name: "deadline", type: "uint256" },
        ],
    };
    const ownerAddr = overrideOwnerAddr ?? await ownerSigner.getAddress();
    const nonce = await stableCoin.nonces(ownerAddr);
    const msg = {
        owner: ownerAddr,
        spender: await vesting.getAddress(),
        value,
        nonce,
        deadline: Number(deadlineSeconds),
    };
    const sig = await ownerSigner.signTypedData(domain, types, msg);
    return ethers.Signature.from(sig); // { v, r, s }
}

async function ensureBalance(stableCoin, to, amount) {
    const [owner] = await ethers.getSigners();
    if (stableCoin.mint) {
        await stableCoin.mint(to, amount);
    } else {
        await stableCoin.connect(owner).transfer(to, amount);
    }
}

describe("TokenVesting.buyBox — 에러 케이스(직접 호출, Forwarder 미사용)", function () {
    it("box=0 → revert('box=0')", async () => {
        const { buyer, vesting, seedReferralFor, referrer } = await deployFixture();
        const ref = await seedReferralFor(referrer);
        const pSkip = makePermit(0n, 0n);
        await expect(
            vesting.connect(buyer).buyBox(0n, ref, pSkip)
        ).to.be.revertedWith("box=0");
    });

    it("referral code not found → revert('referral code not found')", async () => {
        const { buyer, vesting } = await deployFixture();
        const badRef = "ABCDEFGH"; // 8자 형식이지만 미등록
        const pSkip = makePermit(0n, 0n);
        await expect(
            vesting.connect(buyer).buyBox(1n, badRef, pSkip)
        ).to.be.revertedWith("referral code not found");
    });

    it("self referral → revert('self referral')", async () => {
        const { buyer, vesting, seedReferralFor } = await deployFixture();
        const myCode = await seedReferralFor(buyer);
        const pSkip = makePermit(0n, 0n);
        await expect(
            vesting.connect(buyer).buyBox(1n, myCode, pSkip)
        ).to.be.revertedWith("self referral");
    });

    it("not started → revert('not started')", async function () {
        const fixtureAcceptsNotStarted = false;
        if (!fixtureAcceptsNotStarted) this.skip();
    });

    it("no schedule → revert('no schedule')", async function () {
        const fixtureAcceptsNoSchedule = false;
        if (!fixtureAcceptsNoSchedule) this.skip();
    });

    it("The amount to be paid is incorrect. (permit.value ≠ estimated)", async () => {
        const { buyer, referrer, vesting, stableCoin, seedReferralFor } = await deployFixture();
        const ref = await seedReferralFor(referrer);

        const boxCount = 2n;
        const est = await vesting.estimatedTotalAmount(boxCount, ref);
        expect(est).to.be.gt(0n);

        await ensureBalance(stableCoin, buyer.address, est);

        const wrong = est - 1n; // 일부러 1 줄임
        const deadline = BigInt((await time.latest())) + 3600n;
        const { v, r, s } = await signPermit(buyer, stableCoin, vesting, wrong, deadline);

        await expect(
            vesting.connect(buyer).buyBox(boxCount, ref, { value: wrong, deadline, v, r, s })
        ).to.be.revertedWith("The amount to be paid is incorrect.");
    });

    it("ERC2612ExpiredSignature (permit deadline 과거)", async () => {
        const { buyer, referrer, vesting, stableCoin, seedReferralFor } = await deployFixture();
        const ref = await seedReferralFor(referrer);

        const est = await vesting.estimatedTotalAmount(1n, ref);
        expect(est).to.be.gt(0n);
        await ensureBalance(stableCoin, buyer.address, est);

        const past = BigInt((await time.latest())) - 1n;
        const { v, r, s } = await signPermit(buyer, stableCoin, vesting, est, past);

        await expect(
            vesting.connect(buyer).buyBox(1n, ref, { value: est, deadline: past, v, r, s })
        ).to.be.revertedWithCustomError(stableCoin, "ERC2612ExpiredSignature");
    });

    it("ERC2612InvalidSigner (signer ≠ owner) → permit 단계에서 revert", async () => {
        const { owner, buyer, referrer, vesting, stableCoin, seedReferralFor } = await deployFixture();

        // buyer와 다른 임의의 signer 선택
        const signers = await ethers.getSigners();
        const stranger = signers.find(s => s.address.toLowerCase() !== buyer.address.toLowerCase());
        if (!stranger) throw new Error("No available stranger signer");
        expect(stranger.address).to.not.equal(buyer.address);

        const ref = await seedReferralFor(referrer);
        const est = await vesting.estimatedTotalAmount(1n, ref);

        // permit까지 도달하도록 선행 조건 세팅
        await vesting.connect(owner).setRecipient(owner.address);
        await ensureBalance(stableCoin, buyer.address, est);

        const deadline = BigInt((await time.latest())) + 3600n;

        // 메시지의 owner는 buyer로 넣되, stranger가 서명 → 서명자 불일치
        const { v, r, s } = await signPermit(
            stranger,           // 실제 서명자 (≠ buyer)
            stableCoin,
            vesting,
            est,
            deadline,
            buyer.address       // 메시지의 owner 필드는 buyer로 고정
        );

        // 구현별 에러명이 다를 수 있으므로 '어떤 revert든' 발생만 검증
        await expect(
            vesting.connect(buyer).buyBox(1n, ref, { value: est, deadline, v, r, s })
        ).to.be.reverted;
    });


    it("ERC20InsufficientAllowance (approve 경로, allowance < needed)", async () => {
        const { owner, buyer, referrer, vesting, stableCoin, seedReferralFor } = await deployFixture(); // ⭐ owner 추가
        const ref = await seedReferralFor(referrer);

        const need = await vesting.estimatedTotalAmount(1n, ref);
        expect(need).to.be.gt(0n);
        await ensureBalance(stableCoin, buyer.address, need); // 잔액은 충분

        // approve를 아주 작게
        await stableCoin.connect(buyer).approve(await vesting.getAddress(), need - 1n);

        // deadline=0 → permit 스킵, allowance 경로 사용
        const pSkip = makePermit(need, 0n);     // ⭐ value=need 맞추기
        await vesting.connect(owner).setRecipient(owner.address); // ⭐ recipient 세팅
        await expect(
            vesting.connect(buyer).buyBox(1n, ref, pSkip)
        ).to.be.revertedWithCustomError(stableCoin, "ERC20InsufficientAllowance");
    });

    it("ERC20InsufficientBalance (approve 경로, balance < needed)", async () => {
        const { owner, buyer, referrer, vesting, stableCoin, seedReferralFor } = await deployFixture(); // ⭐ owner 추가
        const ref = await seedReferralFor(referrer);

        const need = await vesting.estimatedTotalAmount(1n, ref);
        expect(need).to.be.gt(0n);

        // allowance는 크게(충분히), 잔액은 0 또는 부족
        await vesting.connect(owner).setRecipient(owner.address); // ⭐ recipient 세팅
        await stableCoin.connect(buyer).approve(await vesting.getAddress(), need);

        // 잔액 고의 부족: 아무것도 민트/전송하지 않음
        const pSkip = makePermit(need, 0n); // ⭐ value=need 맞추기
        await expect(
            vesting.connect(buyer).buyBox(1n, ref, pSkip)
        ).to.be.revertedWithCustomError(stableCoin, "ERC20InsufficientBalance");
    });

    it("ERC20InvalidApprover (경로상 발생 불가: approve(owner=0))", async function () {
        this.skip();
    });

    it("ERC20InvalidSpender (경로상 발생 불가: approve(spender=0))", async function () {
        this.skip();
    });

    it("ERC20InvalidSender / ERC20InvalidReceiver (경로상 발생 불가)", async function () {
        this.skip();
    });
});
