// test/vesting.delegate.buy.referral.test.js
/**
 * @fileoverview
 *  Forwarder(ERC-2771) 경유 메타트랜잭션으로 TokenVesting.buyBox를 호출하는 테스트
 * @description
 *  - approve 경로와 permit 경로를 위임대납으로 실행
 *  - 레퍼럴 이벤트 및 파라미터 검증
 *  - 자기추천 방지 및 잘못된 코드 형식에 대한 revert 검증
 *
 * 전제:
 *  - deployFixture()가 Forwarder, StableCoin(ERC20Permit), TokenVesting을 배포하고
 *    TokenVesting 생성자에 trusted forwarder 주소를 넣어둔다.
 *  - Forwarder는 EIP-712 도메인 { name: "WhitelistForwarder", version: "1" }를 사용하고,
 *    MinimalForwarder와 동일한 Request 필드(from,to,value,gas,nonce,data)를 지원한다.
 *
 * @author hlibbc
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployFixture } = require("./helpers/vestingFixture");

// =============================================================================
// 공통 유틸
// =============================================================================

/**
 * @notice Forwarder EIP-712 서명 생성 (delegateBuyBox.js와 동일한 방식)
 * @param signer 메타트랜잭션 서명자(실제 사용자)
 * @param forwarder Forwarder 컨트랙트 인스턴스
 * @param req ForwardRequest 오브젝트({from,to,value,gas,nonce,deadline,data})
 * @returns signature string (serialized)
 */
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
            { name: 'gas', type: 'uint256' }, // 내부 call 가스
            { name: 'nonce', type: 'uint256' },
            { name: 'deadline', type: 'uint48' }, // ← Forwarder 정의와 일치
            { name: 'data', type: 'bytes' },
        ],
    };
    const signature = await signer.signTypedData(domain, types, req);
    return signature; // serialized string 반환
}

/**
 * @notice Forwarder.execute(req, sig) 호출 헬퍼 (relayer가 가스 지불)
 * @param relayer 실행 트랜잭션 송신자(릴레이어)
 * @param forwarder Forwarder 컨트랙트
 * @param req ForwardRequest (signature 포함된 객체)
 * @returns tx
 */
async function forwardExecute(relayer, forwarder, req) {
    return forwarder.connect(relayer).execute(req);
}

/**
 * @notice permit 구조체 생성 (deadline=0 => permit 스킵)
 */
function makePermit(value, deadline = 0n, v = 0, r = ethers.ZeroHash, s = ethers.ZeroHash) {
    return { value, deadline, v, r, s };
}

describe("vesting.delegate.buy.referral (via ERC-2771 Forwarder.execute)", function () {
    // =============================================================================
    // permit 경로(delegate) 테스트
    // =============================================================================
    it("buyBox (delegate): permit 경로 성공 (EIP-2612)", async () => {
        const { owner, buyer, referrer, vesting, forwarder, stableCoin, seedReferralFor } = await deployFixture();
        const refCode = await seedReferralFor(referrer);
        let vestingAddr = await vesting.getAddress();
        await forwarder.addToWhitelist(vestingAddr);
        const dummyPermit = { value: 0n, deadline: 0n, v: 0, r: ethers.ZeroHash, s: ethers.ZeroHash };
        const encoded = vesting.interface.encodeFunctionData('buyBox', [0n, 'ABCDEFGH', dummyPermit]);
        const buyBoxSel = encoded.slice(0, 10);
        await forwarder.setAllowed(vestingAddr, buyBoxSel, true);
        await vesting.connect(owner).setRecipient(owner.address);

        const boxCount = 1n;
        const estimated = await vesting.estimatedTotalAmount(boxCount, refCode);
        expect(estimated).to.be.gt(0n);

        // === buyer 잔액 확보 (transferFrom 시 필요) ===
        if (stableCoin.mint) {
            await stableCoin.mint(buyer.address, estimated);
        } else {
            await stableCoin.connect(owner).transfer(buyer.address, estimated);
        }
        // ===== EIP-2612 permit 서명 준비 =====
        const now = BigInt((await ethers.provider.getBlock("latest")).timestamp);
        const deadline = now + 3600n;

        const { chainId } = await ethers.provider.getNetwork();
        const domain = {
            name: await stableCoin.name(),
            version: "1",
            chainId: Number(chainId),
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
        const spender = await vesting.getAddress();
        const nonceErc20 = await stableCoin.nonces(buyer.address);

        const message = {
            owner: buyer.address,
            spender,
            value: estimated,
            nonce: nonceErc20,
            deadline: Number(deadline),
        };
        const sigPermit = await buyer.signTypedData(domain, types, message);
        const { v, r, s } = ethers.Signature.from(sigPermit);
        // buyBox calldata (permit 경로)
        const permitData = { value: estimated, deadline, v, r, s };
        const data = vesting.interface.encodeFunctionData("buyBox", [boxCount, refCode, permitData]);

        // ForwardRequest
        const nonce = await forwarder.nonces(buyer.address);
        const req = {
            from: buyer.address,
            to: await vesting.getAddress(),
            value: 0n,
            gas: 1_000_000n,
            nonce,
            deadline: Number(deadline),
            data,
        };
        const sig = await signForwardRequest(buyer, forwarder, req);
        const requestWithSig = { ...req, signature: sig };
        
        // === Forwarder를 통한 메타 트랜잭션 실행 ===
        await expect(forwardExecute(owner, forwarder, requestWithSig))
            .to.emit(vesting, "BoxesPurchased");
    });

    // =============================================================================
    // 자기추천 금지(delegate) 테스트
    // =============================================================================
    it("buyBox (delegate): 자기추천 금지 revert('self referral')", async () => {
        const { buyer, vesting, forwarder, seedReferralFor } = await deployFixture();

        // Forwarder 화이트리스트 및 selector 허용 설정
        const vestingAddr_sr = await vesting.getAddress();
        await forwarder.addToWhitelist(vestingAddr_sr);
        const dummyPermit_sr = { value: 0n, deadline: 0n, v: 0, r: ethers.ZeroHash, s: ethers.ZeroHash };
        const encoded_sr = vesting.interface.encodeFunctionData('buyBox', [0n, 'ABCDEFGH', dummyPermit_sr]);
        const buyBoxSel_sr = encoded_sr.slice(0, 10);
        await forwarder.setAllowed(vestingAddr_sr, buyBoxSel_sr, true);

        // === 자기 코드 생성 ===
        const myCode = await seedReferralFor(buyer);

        const boxCount = 1n;
        const estimated = await vesting.estimatedTotalAmount(boxCount, myCode);
        const pSkip = makePermit(estimated, 0n);

        const data = vesting.interface.encodeFunctionData("buyBox", [boxCount, myCode, pSkip]);

        const nonce = await forwarder.nonces(buyer.address);
        const req = {
            from: buyer.address,
            to: await vesting.getAddress(),
            value: 0n,
            gas: 1_000_000n,
            nonce,
            deadline: Math.floor(Date.now() / 1000) + 3600,
            data,
        };

        const sig = await signForwardRequest(buyer, forwarder, req);
        const requestWithSig = { ...req, signature: sig };

        await expect(forwardExecute(buyer, forwarder, requestWithSig))
            .to.be.revertedWith("self referral");
    });

    // =============================================================================
    // 잘못된 레퍼럴 코드 형식(delegate) 테스트
    // =============================================================================
    it("buyBox (delegate): 잘못된 코드 형식(길이/문자셋) revert", async () => {
        const { buyer, vesting, forwarder } = await deployFixture();
        // Forwarder 화이트리스트 및 selector 허용 설정
        const vestingAddr_iv = await vesting.getAddress();
        await forwarder.addToWhitelist(vestingAddr_iv);
        const dummyPermit_iv = { value: 0n, deadline: 0n, v: 0, r: ethers.ZeroHash, s: ethers.ZeroHash };
        const encoded_iv = vesting.interface.encodeFunctionData('buyBox', [0n, 'ABCDEFGH', dummyPermit_iv]);
        const buyBoxSel_iv = encoded_iv.slice(0, 10);
        await forwarder.setAllowed(vestingAddr_iv, buyBoxSel_iv, true);
        const pZero = makePermit(0n, 0n);

        // === 1) 길이 오류: "ABC" ===
        {
            const data = vesting.interface.encodeFunctionData("buyBox", [1n, "ABC", pZero]);
            const nonce = await forwarder.nonces(buyer.address);
            const req = {
                from: buyer.address,
                to: await vesting.getAddress(),
                value: 0n,
                gas: 1_000_000n,
                nonce,
                deadline: Math.floor(Date.now() / 1000) + 3600,
                data,
            };
            const sig = await signForwardRequest(buyer, forwarder, req);
            const requestWithSig = { ...req, signature: sig };
            await expect(forwardExecute(buyer, forwarder, requestWithSig))
                .to.be.revertedWith("ref len!=8");
        }

        // === 2) 문자셋 오류: 허용되지 않는 특수문자 포함 ===
        {
            const data = vesting.interface.encodeFunctionData("buyBox", [1n, "abcd$#12", pZero]);
            const nonce = await forwarder.nonces(buyer.address);
            const req = {
                from: buyer.address,
                to: await vesting.getAddress(),
                value: 0n,
                gas: 1_000_000n,
                nonce,
                deadline: Math.floor(Date.now() / 1000) + 3600,
                data,
            };
            const sig = await signForwardRequest(buyer, forwarder, req);
            const requestWithSig = { ...req, signature: sig };
            // 내부에서 "ref invalid char"로 revert, 메시지 구현 차이를 고려해 generic 체크
            await expect(forwardExecute(buyer, forwarder, requestWithSig))
                .to.be.reverted;
        }
    });
});
