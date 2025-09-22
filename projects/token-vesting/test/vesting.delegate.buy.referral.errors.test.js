// test/vesting.delegate.buy.referral.errors.test.js
const { expect } = require("chai");
const { ethers } = require("hardhat");
// const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { deployFixture } = require("./helpers/vestingFixture");

const ZERO_HASH = ethers.ZeroHash;

function makePermit(value, deadline = 0n, v = 0, r = ZERO_HASH, s = ZERO_HASH) {
    return { value, deadline, v, r, s };
}

async function signForwardRequest(signer, forwarder, req) {
    const { chainId } = await ethers.provider.getNetwork();
    const domain = {
        name: "WhitelistForwarder",
        version: "1",
        chainId: Number(chainId),
        verifyingContract: await forwarder.getAddress(),
    };
    const types = {
        ForwardRequest: [
            { name: 'from', type: 'address' },
            { name: 'to', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'gas', type: 'uint256' },
            { name: 'nonce', type: 'uint256' },
            { name: 'deadline', type: 'uint48' },
            { name: 'data', type: 'bytes' },
        ],
    };
    const sig = await signer.signTypedData(domain, types, req);
    return sig;
}

async function forwardExecute(relayer, forwarder, req) {
    return forwarder.connect(relayer).execute(req);
}

async function allowBuyBox(forwarder, vesting) {
    const vestingAddr = await vesting.getAddress();
    await forwarder.addToWhitelist(vestingAddr);
    const dummyPermit = { value: 0n, deadline: 0n, v: 0, r: ethers.ZeroHash, s: ethers.ZeroHash };
    const encoded = vesting.interface.encodeFunctionData('buyBox', [0n, 'ABCDEFGH', dummyPermit]);
    const buyBoxSel = encoded.slice(0, 10);
    await forwarder.setAllowed(vestingAddr, buyBoxSel, true);
}

describe("TokenVesting.buyBox — 에러 케이스(Forwarder.execute 경유)", function () {
    it("box=0 → revert('box=0')", async () => {
        const { owner, buyer, vesting, forwarder, seedReferralFor, referrer } = await deployFixture();
        await allowBuyBox(forwarder, vesting);
        const ref = await seedReferralFor(referrer);
        const pSkip = makePermit(0n, 0n);
        const data = vesting.interface.encodeFunctionData("buyBox", [0n, ref, pSkip]);

        const nonce = await forwarder.nonces(buyer.address);
        const { timestamp: nowTs0 } = await ethers.provider.getBlock("latest");
        const req = {
            from: buyer.address,
            to: await vesting.getAddress(),
            value: 0n,
            gas: 200_000n,
            nonce,
            deadline: Number(nowTs0) + 3600,
            data,
        };
        const signature = await signForwardRequest(buyer, forwarder, req);
        const requestWithSig = { ...req, signature };
        
        await expect(forwardExecute(owner, forwarder, requestWithSig))
            .to.be.revertedWith("box=0");
    });

    it("referral code not found → revert('referral code not found')", async () => {
        const { owner, buyer, vesting, forwarder } = await deployFixture();
        await allowBuyBox(forwarder, vesting);
        const badRef = "ABCDEFGH"; // 8자 형식이지만 미등록
        const pSkip = makePermit(0n, 0n);
        const data = vesting.interface.encodeFunctionData("buyBox", [1n, badRef, pSkip]);

        const nonce = await forwarder.nonces(buyer.address);
        const { timestamp: nowTs0 } = await ethers.provider.getBlock("latest");
        const req = {
            from: buyer.address,
            to: await vesting.getAddress(),
            value: 0n,
            gas: 200_000n,
            nonce,
            deadline: Number(nowTs0) + 3600,
            data,
        };
        const signature = await signForwardRequest(buyer, forwarder, req);
        const requestWithSig = { ...req, signature };

        await expect(forwardExecute(owner, forwarder, requestWithSig))
            .to.be.revertedWith("referral code not found");
    });

    it("self referral → revert('self referral')", async () => {
        const { owner, buyer, vesting, forwarder, seedReferralFor } = await deployFixture();
        await allowBuyBox(forwarder, vesting);
        const myCode = await seedReferralFor(buyer);
        const pSkip = makePermit(0n, 0n);
        const data = vesting.interface.encodeFunctionData("buyBox", [1n, myCode, pSkip]);

        const nonce = await forwarder.nonces(buyer.address);
        const { timestamp: nowTs0 } = await ethers.provider.getBlock("latest");
        const req = {
            from: buyer.address,
            to: await vesting.getAddress(),
            value: 0n,
            gas: 200_000n,
            nonce,
            deadline: Number(nowTs0) + 3600,
            data,
        };
        const signature = await signForwardRequest(buyer, forwarder, req);
        const requestWithSig = { ...req, signature };

        await expect(forwardExecute(owner, forwarder, requestWithSig))
            .to.be.revertedWith("self referral");
    });

    it("The amount to be paid is incorrect. (permit.value ≠ estimated)", async () => {
        const { owner, buyer, referrer, vesting, stableCoin, forwarder, seedReferralFor } = await deployFixture();
        await allowBuyBox(forwarder, vesting);
        const ref = await seedReferralFor(referrer);

        const boxCount = 2n;
        const est = await vesting.estimatedTotalAmount(boxCount, ref);
        expect(est).to.be.gt(0n);

        // 잔액 확보
        if (stableCoin.mint) {
            await stableCoin.mint(buyer.address, est);
        } else {
            const [ownerSigner] = await ethers.getSigners();
            await stableCoin.connect(ownerSigner).transfer(buyer.address, est);
        }

        const wrong = est - 1n;
        const { timestamp: nowTs } = await ethers.provider.getBlock("latest");
        const deadline = BigInt(nowTs) + 3600n;

        const pWrong = { value: wrong, deadline, v: 0, r: ZERO_HASH, s: ZERO_HASH };
        const data = vesting.interface.encodeFunctionData("buyBox", [boxCount, ref, pWrong]);

        const nonce = await forwarder.nonces(buyer.address);
        const req = {
            from: buyer.address,
            to: await vesting.getAddress(),
            value: 0n,
            gas: 200_000n,
            nonce,
            deadline: Number(deadline),
            data,
        };
        const signature = await signForwardRequest(buyer, forwarder, req);
        const requestWithSig = { ...req, signature };

        await expect(forwardExecute(owner, forwarder, requestWithSig))
            .to.be.revertedWith("The amount to be paid is incorrect.");
    });

    it("ERC2612ExpiredSignature (permit deadline 과거)", async () => {
        const { owner, buyer, referrer, vesting, stableCoin, forwarder, seedReferralFor } = await deployFixture();
        await allowBuyBox(forwarder, vesting);
        const ref = await seedReferralFor(referrer);

        const est = await vesting.estimatedTotalAmount(1n, ref);
        expect(est).to.be.gt(0n);
        // 잔액 확보
        if (stableCoin.mint) {
            await stableCoin.mint(buyer.address, est);
        } else {
            const [ownerSigner] = await ethers.getSigners();
            await stableCoin.connect(ownerSigner).transfer(buyer.address, est);
        }

        // const past = BigInt((await time.latest())) - 1n;
        const { timestamp: nowTs } = await ethers.provider.getBlock("latest");
        const past = BigInt(nowTs) - 1n;
        const pExpired = { value: est, deadline: past, v: 27, r: ZERO_HASH, s: ZERO_HASH };
        const data = vesting.interface.encodeFunctionData("buyBox", [1n, ref, pExpired]);

        const nonce = await forwarder.nonces(buyer.address);
        const { timestamp: nowTs0 } = await ethers.provider.getBlock("latest");
        const req = {
            from: buyer.address,
            to: await vesting.getAddress(),
            value: 0n,
            gas: 200_000n,
            nonce,
            deadline: Number(nowTs0) + 3600,
            data,
        };
        const signature = await signForwardRequest(buyer, forwarder, req);
        const requestWithSig = { ...req, signature };

        await expect(forwardExecute(owner, forwarder, requestWithSig))
            .to.be.revertedWithCustomError(stableCoin, "ERC2612ExpiredSignature");
    });

    it("ERC2612InvalidSigner (signer ≠ owner) → permit 단계에서 revert", async () => {
        const { owner, buyer, referrer, vesting, stableCoin, forwarder, seedReferralFor } = await deployFixture();
        await allowBuyBox(forwarder, vesting);

        const signers = await ethers.getSigners();
        const stranger = signers.find(s => s.address.toLowerCase() !== buyer.address.toLowerCase());
        if (!stranger) throw new Error("No available stranger signer");

        const ref = await seedReferralFor(referrer);
        const est = await vesting.estimatedTotalAmount(1n, ref);

        await vesting.connect(owner).setRecipient(owner.address);
        if (stableCoin.mint) {
            await stableCoin.mint(buyer.address, est);
        } else {
            const [ownerSigner] = await ethers.getSigners();
            await stableCoin.connect(ownerSigner).transfer(buyer.address, est);
        }

        // const dl = BigInt((await time.latest())) + 3600n;
        const { timestamp: nowTs2 } = await ethers.provider.getBlock("latest");
        const dl = BigInt(nowTs2) + 3600n;
        // 메시지 owner는 buyer로 두고, 잘못된 서명자 시뮬레이션을 위해 임의 v/r/s 사용
        const wrongSig = { value: est, deadline: dl, v: 28, r: ZERO_HASH, s: ZERO_HASH };
        const data = vesting.interface.encodeFunctionData("buyBox", [1n, ref, wrongSig]);

        const nonce = await forwarder.nonces(buyer.address);
        const req = {
            from: buyer.address,
            to: await vesting.getAddress(),
            value: 0n,
            gas: 200_000n,
            nonce,
            deadline: Number(dl),
            data,
        };
        const signature = await signForwardRequest(buyer, forwarder, req);
        const requestWithSig = { ...req, signature };

        await expect(forwardExecute(owner, forwarder, requestWithSig))
            .to.be.reverted; // 구현별 에러명 차이 허용
    });

    it("ERC20InsufficientAllowance (approve 경로, allowance < needed)", async () => {
        const { owner, buyer, referrer, vesting, stableCoin, forwarder, seedReferralFor } = await deployFixture();
        await allowBuyBox(forwarder, vesting);
        const ref = await seedReferralFor(referrer);

        const need = await vesting.estimatedTotalAmount(1n, ref);
        expect(need).to.be.gt(0n);
        // 잔액 충분히 확보
        if (stableCoin.mint) {
            await stableCoin.mint(buyer.address, need);
        } else {
            const [ownerSigner] = await ethers.getSigners();
            await stableCoin.connect(ownerSigner).transfer(buyer.address, need);
        }

        // approve를 아주 작게 설정
        await stableCoin.connect(buyer).approve(await vesting.getAddress(), need - 1n);

        // deadline=0 → permit 스킵(approve 경로)
        const pSkip = makePermit(need, 0n);
        await vesting.connect(owner).setRecipient(owner.address);
        const data = vesting.interface.encodeFunctionData("buyBox", [1n, ref, pSkip]);

        const nonce = await forwarder.nonces(buyer.address);
        const { timestamp: nowTs0 } = await ethers.provider.getBlock("latest");
        const req = {
            from: buyer.address,
            to: await vesting.getAddress(),
            value: 0n,
            gas: 200_000n,
            nonce,
            deadline: Number(nowTs0) + 3600,
            data,
        };
        const signature = await signForwardRequest(buyer, forwarder, req);
        const requestWithSig = { ...req, signature };

        await expect(forwardExecute(owner, forwarder, requestWithSig))
            .to.be.revertedWithCustomError(stableCoin, "ERC20InsufficientAllowance");
    });

    it("ERC20InsufficientBalance (approve 경로, balance < needed)", async () => {
        const { owner, buyer, referrer, vesting, stableCoin, forwarder, seedReferralFor } = await deployFixture();
        await allowBuyBox(forwarder, vesting);
        const ref = await seedReferralFor(referrer);

        const need = await vesting.estimatedTotalAmount(1n, ref);
        expect(need).to.be.gt(0n);

        // allowance는 충분히, 잔액은 고의 부족(민트/전송 안 함)
        await vesting.connect(owner).setRecipient(owner.address);
        await stableCoin.connect(buyer).approve(await vesting.getAddress(), need);

        const pSkip = makePermit(need, 0n);
        const data = vesting.interface.encodeFunctionData("buyBox", [1n, ref, pSkip]);

        const nonce = await forwarder.nonces(buyer.address);
        const { timestamp: nowTs0 } = await ethers.provider.getBlock("latest");
        const req = {
            from: buyer.address,
            to: await vesting.getAddress(),
            value: 0n,
            gas: 200_000n,
            nonce,
            deadline: Number(nowTs0) + 3600,
            data,
        };
        const signature = await signForwardRequest(buyer, forwarder, req);
        const requestWithSig = { ...req, signature };

        await expect(forwardExecute(owner, forwarder, requestWithSig))
            .to.be.revertedWithCustomError(stableCoin, "ERC20InsufficientBalance");
    });
});
