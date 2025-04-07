const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DebugNestedPermit - Full EIP-712 Testing + Internal Debugging", function () {
  let contract, signer, notSigner;
  const chainId = 31337;

  const types = {
    Person: [
      { name: "wallet", type: "address" },
      { name: "name", type: "string" },
    ],
    Order: [
      { name: "from", type: "Person" },
      { name: "to", type: "Person" },
      { name: "amount", type: "uint256" },
      { name: "nonce", type: "uint256" },
    ],
  };

  beforeEach(async () => {
    [signer, notSigner] = await ethers.getSigners();
    const DebugNestedPermit = await ethers.getContractFactory("DebugNestedPermit");
    contract = await DebugNestedPermit.deploy();
    await contract.waitForDeployment();
  });

  function buildOrder(from, to, amount, nonce) {
    return {
      from: { wallet: from, name: "Alice" },
      to: { wallet: to, name: "Bob" },
      amount,
      nonce,
    };
  }

  async function buildDomain() {
    return {
      name: "NestedPermitApp",
      version: "1",
      chainId,
      verifyingContract: await contract.getAddress(),
    };
  }

  it("✅ should match digest and structHash with off-chain values", async () => {
    const domain = await buildDomain();
    const order = buildOrder(signer.address, ethers.ZeroAddress, ethers.parseEther("1"), 1);
    const digestOffchain = ethers.TypedDataEncoder.hash(domain, types, order);

    const structHashOnChain = await contract.getStructHash(order);
    const digestOnChain = await contract.getDigest(order);
    const domainSep = await contract.getDomainSeparator();

    expect(digestOnChain).to.equal(digestOffchain);
    expect(structHashOnChain).to.match(/^0x[0-9a-fA-F]{64}$/);
    expect(domainSep).to.match(/^0x[0-9a-fA-F]{64}$/);
  });

  it("✅ should accept valid signature from EOA", async () => {
    const domain = await buildDomain();
    const order = buildOrder(signer.address, ethers.ZeroAddress, ethers.parseEther("1"), 1);

    const signature = await signer.signTypedData(domain, types, order);
    const valid = await contract.verify(order, signature);
    expect(valid).to.equal(true);

    const recovered = await contract.recoverSigner(order, signature);
    expect(recovered).to.equal(signer.address);
  });

  it("❌ should reject signature from wrong signer", async () => {
    const domain = await buildDomain();
    const order = buildOrder(signer.address, ethers.ZeroAddress, ethers.parseEther("1"), 1);

    const signature = await notSigner.signTypedData(domain, types, order);
    const valid = await contract.verify(order, signature);
    expect(valid).to.equal(false);

    const recovered = await contract.recoverSigner(order, signature);
    expect(recovered).to.not.equal(signer.address);
  });

  it("❌ should reject if order is tampered", async () => {
    const domain = await buildDomain();
    const originalOrder = buildOrder(signer.address, ethers.ZeroAddress, ethers.parseEther("1"), 1);

    const signature = await signer.signTypedData(domain, types, originalOrder);

    const tampered = {
      ...originalOrder,
      from: { ...originalOrder.from, name: "Evil Alice" }
    };

    const valid = await contract.verify(tampered, signature);
    expect(valid).to.equal(false);
  });

  it("✅ should verify EIP-1271 wallet signature", async () => {
    const EIP1271 = await ethers.getContractFactory("EIP1271WalletMock");
    const wallet = await EIP1271.deploy(signer.address);
    await wallet.waitForDeployment();

    const domain = await buildDomain();
    const order = buildOrder(await wallet.getAddress(), ethers.ZeroAddress, ethers.parseEther("1"), 1);

    const signature = await signer.signTypedData(domain, types, order);
    const digest = ethers.TypedDataEncoder.hash(domain, types, order);

    const magicValue = await wallet.isValidSignature(digest, signature);
    expect(magicValue).to.equal("0x1626ba7e");

    const isValid = await contract.verify(order, signature);
    expect(isValid).to.equal(true);

    const recovered = await contract.recoverSigner(order, signature);
    expect(recovered).to.equal(await wallet.getAddress());
  });

  it("❌ should reject bad EIP-1271 signature", async () => {
    const EIP1271 = await ethers.getContractFactory("EIP1271WalletMock");
    const fakeWallet = await EIP1271.deploy(notSigner.address);
    await fakeWallet.waitForDeployment();

    const domain = await buildDomain();
    const order = buildOrder(await fakeWallet.getAddress(), ethers.ZeroAddress, ethers.parseEther("1"), 1);

    const signature = await signer.signTypedData(domain, types, order);
    const digest = ethers.TypedDataEncoder.hash(domain, types, order);

    const magicValue = await fakeWallet.isValidSignature(digest, signature);
    expect(magicValue).to.not.equal("0x1626ba7e");

    const isValid = await contract.verify(order, signature);
    expect(isValid).to.equal(false);

    const recovered = await contract.recoverSigner(order, signature);
    expect(recovered).to.not.equal(await fakeWallet.getAddress());
  });
});
