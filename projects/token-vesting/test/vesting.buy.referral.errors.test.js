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
        // 테스트 토큰이 이미 owner에게 충분히 있다고 가정
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

    it("not started → revert('not started')", async () => {
        const { buyer, vesting, seedReferralFor, referrer } = await deployFixture({ startOffsetSec: 3600 }); 
        // ↑ deployFixture가 시작 시간을 현재보다 +1시간으로 배포하도록 옵션 지원한다고 가정.
        // 만약 옵션이 없다면, 아래처럼 컨트랙트의 start를 읽어와 블록타임을 start-1로 맞춘 뒤 실행해줘.
        // const start =
        //     (await vesting.vestingStartDate?.()) ??
        //     (await vesting.getVestingStartDate?.()) ??
        //     null;
        // if (start) await time.setNextBlockTimestamp(Number(start) - 1);

        const ref = await seedReferralFor(referrer);

        // 금액은 계산되지만 아직 시작 전이라 실패
        const est = await vesting.estimatedTotalAmount(1n, ref);
        expect(est).to.be.gt(0n);

        const pSkip = makePermit(0n, 0n);
        await expect(
            vesting.connect(buyer).buyBox(1n, ref, pSkip)
        ).to.be.revertedWith("not started");
    });

    it("no schedule → revert('no schedule')", async function () {
        // 픽스처가 스케줄 미초기화 배포 옵션을 제공한다면:
        // const { buyer, vesting, seedReferralFor, referrer } = await deployFixture({ initSchedule: false });
        // 없다면 이 케이스는 경로상 만들 수 없으므로 skip
        const fixtureAcceptsNoSchedule = false; // ← 프로젝트에 맞게 바꿔줘
        if (!fixtureAcceptsNoSchedule) {
            this.skip(); // 설명: 현재 픽스처/배포 로직에서 스케줄은 항상 초기화됨
        }
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

    it("ERC2612InvalidSigner (signer ≠ owner)", async () => {
        const { buyer, referrer, vesting, stableCoin, seedReferralFor } = await deployFixture();
        const [, stranger] = await ethers.getSigners();
        const ref = await seedReferralFor(referrer);

        const est = await vesting.estimatedTotalAmount(1n, ref);
        await ensureBalance(stableCoin, buyer.address, est);

        const deadline = BigInt((await time.latest())) + 3600n;
        // 메시지의 owner는 buyer로 넣되, stranger가 서명 → InvalidSigner
        const { v, r, s } = await signPermit(stranger, stableCoin, vesting, est, deadline, /*overrideOwnerAddr=*/buyer.address);

        await expect(
            vesting.connect(buyer).buyBox(1n, ref, { value: est, deadline, v, r, s })
        ).to.be.revertedWithCustomError(stableCoin, "ERC2612InvalidSigner");
    });

    it("ERC20InsufficientAllowance (approve 경로, allowance < needed)", async () => {
        const { buyer, referrer, vesting, stableCoin, seedReferralFor } = await deployFixture();
        const ref = await seedReferralFor(referrer);

        const need = await vesting.estimatedTotalAmount(1n, ref);
        expect(need).to.be.gt(0n);
        await ensureBalance(stableCoin, buyer.address, need); // 잔액은 충분

        // approve를 아주 작게
        await stableCoin.connect(buyer).approve(await vesting.getAddress(), need - 1n);

        // deadline=0 → permit 스킵, allowance 경로 사용
        const pSkip = makePermit(0n, 0n);
        await expect(
            vesting.connect(buyer).buyBox(1n, ref, pSkip)
        ).to.be.revertedWithCustomError(stableCoin, "ERC20InsufficientAllowance");
    });

    it("ERC20InsufficientBalance (approve 경로, balance < needed)", async () => {
        const { buyer, referrer, vesting, stableCoin, seedReferralFor } = await deployFixture();
        const ref = await seedReferralFor(referrer);

        const need = await vesting.estimatedTotalAmount(1n, ref);
        expect(need).to.be.gt(0n);

        // allowance는 크게(충분히), 잔액은 0 또는 부족
        await stableCoin.connect(buyer).approve(await vesting.getAddress(), need);
        // 잔액 고의 부족: 아무것도 민트/전송하지 않음(혹은 아주 작게 민트)
        // await ensureBalance(stableCoin, buyer.address, need - 1n);

        const pSkip = makePermit(0n, 0n);
        await expect(
            vesting.connect(buyer).buyBox(1n, ref, pSkip)
        ).to.be.revertedWithCustomError(stableCoin, "ERC20InsufficientBalance");
    });

    // ───── 아래 3가지는 buyBox 경로상 '정상 구성'이면 발생 불가(제로 주소 사용 등) ─────
    it("ERC20InvalidApprover (경로상 발생 불가: approve(owner=0))", async function () {
        // buyBox는 approve를 직접 호출하지 않고, 호출해도 owner는 msg.sender라 0이 될 수 없음
        this.skip();
    });

    it("ERC20InvalidSpender (경로상 발생 불가: approve(spender=0))", async function () {
        // buyBox에서 spender는 vesting 주소로 고정 → 0 주소가 아님
        this.skip();
    });

    it("ERC20InvalidSender / ERC20InvalidReceiver (경로상 발생 불가)", async function () {
        // transferFrom(from=buyer, to=vesting/recipient). 둘 다 0 주소가 아님
        this.skip();
    });
});
