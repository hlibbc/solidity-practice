const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MyPermitToken - EIP-2612 Debugging (Ethers v6)", function () {
  let token;
  let owner, spender, others;

  const name = "MyPermitToken";
  const version = "1";
  const value = ethers.parseUnits("10", 18);
  
  beforeEach(async function () {
    [owner, spender, others] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("MyPermitToken");
    token = await Token.deploy();
    await token.waitForDeployment();
  });

  it("should match on-chain and off-chain digest and recover same signer", async function () {
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const nonce = await token.nonces(owner.address);

    // 실제 네트워크의 체인 ID 가져오기
    const network = await ethers.provider.getNetwork();
    const chainId = network.chainId;

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

    ////  jhhong
    // ===== 배포된 컨트랙트 정보 출력 =====
    console.log("\n📋 배포된 컨트랙트 정보:");
    console.log("   컨트랙트 주소:", await token.getAddress());
    console.log("   컨트랙트 이름:", await token.name());
    console.log("   컨트랙트 심볼:", await token.symbol());
    console.log("   버전:", version);
    console.log("   실제 체인 ID:", chainId);
    console.log("   네트워크 이름:", network.name);
    
    // DOMAIN_SEPARATOR 값 출력
    console.log("\n🔐 DOMAIN_SEPARATOR:");
    const domainSeparator = await token.DOMAIN_SEPARATOR();
    console.log("   값:", domainSeparator);
    console.log("   길이:", domainSeparator.length, "문자");
    
    // 올바른 방법: ethers.TypedDataEncoder 사용
    const domainForEncoder = {
        name: name,
        version: version,
        chainId: Number(chainId),
        verifyingContract: await token.getAddress()
    };
    
    const calculatedDomainSeparator = ethers.TypedDataEncoder.hashDomain(domainForEncoder);
    console.log("\n🔍 검증:");
    console.log("   계산된 값:", calculatedDomainSeparator);
    console.log("   일치 여부:", domainSeparator === calculatedDomainSeparator ? "✅ 일치" : "❌ 불일치");
    
    // 디버깅을 위한 추가 정보
    console.log("\n🔍 디버깅 정보:");
    console.log("   Domain 구조:");
    console.log("     - name:", name);
    console.log("     - version:", version);
    console.log("     - chainId:", Number(chainId));
    console.log("     - verifyingContract:", await token.getAddress());
    console.log("=====================================\n");

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
  
    // 실제 네트워크의 체인 ID 가져오기
    const network = await ethers.provider.getNetwork();
    const chainId = network.chainId;
  
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
  
    // 실제 네트워크의 체인 ID 가져오기
    const network = await ethers.provider.getNetwork();
    const chainId = network.chainId;
  
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
