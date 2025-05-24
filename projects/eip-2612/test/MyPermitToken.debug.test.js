const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MyPermitToken - EIP-2612 Debugging (Ethers v6)", function () {
  let token;
  let owner, spender, others;

  const name = "MyPermitToken";
  const version = "1";
  const value = ethers.parseUnits("10", 18);
  const chainId = 31337; // Default chain ID for Hardhat local

  beforeEach(async function () {
    [owner, spender, others] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("MyPermitToken");
    token = await Token.deploy();
    await token.waitForDeployment();
  });

  it("should match on-chain and off-chain digest and recover same signer", async function () {
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const nonce = await token.nonces(owner.address);

    const domain = {
      name: name,
      version: version,
      chainId: chainId,
      verifyingContract: await token.getAddress(),
    };

    const types = {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    };

    const message = {
      owner: owner.address,
      spender: spender.address,
      value: value,
      nonce: nonce,
      deadline: deadline,
    };

    // 🖊️ EIP-712 signature 생성 (Ethers v6)
    const signature = await owner.signTypedData(domain, types, message);
    const sig = ethers.Signature.from(signature);

    // ✅ on-chain에서 digest와 structHash 비교
    const [structHash, digest] = await token.debugPermit_getAllHashes(
      message.owner,
      message.spender,
      message.value,
      message.deadline
    );

    const offchainDigest = ethers.TypedDataEncoder.hash(domain, types, message);
    expect(digest).to.equal(offchainDigest);

    // ✅ on-chain signer 복구
    const onchainSigner = await token.debugPermit_getSigner(
      message.owner,
      message.spender,
      message.value,
      message.deadline,
      sig.v,
      sig.r,
      sig.s
    );

    expect(onchainSigner).to.equal(owner.address);
  });
  it("should revert if signature is not from owner", async function () {
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const nonce = await token.nonces(owner.address);
  
    const domain = {
      name,
      version,
      chainId,
      verifyingContract: await token.getAddress(),
    };
  
    const types = {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    };
  
    const message = {
      owner: owner.address, // 진짜 owner
      spender: spender.address,
      value: value,
      nonce: nonce,
      deadline: deadline,
    };
  
    // ❌ 잘못된 signer로 서명 (spender가 서명함)
    const badSignature = await spender.signTypedData(domain, types, message);
    const badSig = ethers.Signature.from(badSignature);
  
    // 🔥 실제 permit 시도 → 실패해야 함
    await expect(token.permit(
      message.owner,
      message.spender,
      message.value,
      message.deadline,
      badSig.v,
      badSig.r,
      badSig.s
    )).to.be.revertedWithCustomError(token, "ERC2612InvalidSigner");
  });
  it("should revert if signature is from a third party (not owner, not spender)", async function () {
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const nonce = await token.nonces(owner.address);
  
    const domain = {
      name,
      version,
      chainId,
      verifyingContract: await token.getAddress(),
    };
  
    const types = {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    };
  
    const message = {
      owner: owner.address,         // 진짜 owner
      spender: spender.address,     // 진짜 spender
      value: value,
      nonce: nonce,
      deadline: deadline,
    };
  
    // ❌ others(제3자)가 서명함
    const badSignature = await others.signTypedData(domain, types, message);
    const badSig = ethers.Signature.from(badSignature);
  
    // 🔥 permit 시도 → 실패해야 함
    await expect(token.permit(
      message.owner,
      message.spender,
      message.value,
      message.deadline,
      badSig.v,
      badSig.r,
      badSig.s
    )).to.be.revertedWithCustomError(token, "ERC2612InvalidSigner");
  });
});
