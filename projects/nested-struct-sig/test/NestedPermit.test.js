const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("NestedPermit - EIP-712 with Nested Structs", function () {
  let contract, signer;
  const chainId = 31337;

  beforeEach(async () => {
    [signer] = await ethers.getSigners();
    const NestedPermit = await ethers.getContractFactory("NestedPermit");
    contract = await NestedPermit.deploy();
    await contract.waitForDeployment();
  });

  it("should recover correct signer from nested struct signature", async () => {
    const order = {
      from: {
        wallet: signer.address,
        name: "Alice"
      },
      to: {
        wallet: "0x000000000000000000000000000000000000dEaD",
        name: "Bob"
      },
      amount: ethers.parseEther("1"),
      nonce: 1
    };

    const domain = {
      name: "NestedPermitApp",
      version: "1",
      chainId,
      verifyingContract: await contract.getAddress()
    };

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
      ]
    };

    const signature = await signer.signTypedData(domain, types, order);
    const isValid = await contract.verify(order, signature);
    expect(isValid).to.equal(true);

    const recovered = await contract.recoverSigner(order, signature);
    expect(recovered).to.equal(signer.address);
  });
  it("should fail if signed by someone else", async () => {
    const [signer, notSigner] = await ethers.getSigners();

    const order = {
      from: {
        wallet: signer.address,
        name: "Alice"
      },
      to: {
        wallet: "0x000000000000000000000000000000000000dEaD",
        name: "Bob"
      },
      amount: ethers.parseEther("1"),
      nonce: 1
    };

    const domain = {
      name: "NestedPermitApp",
      version: "1",
      chainId,
      verifyingContract: await contract.getAddress()
    };

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
      ]
    };

    const signature = await notSigner.signTypedData(domain, types, order);
    const isValid = await contract.verify(order, signature);
    expect(isValid).to.equal(false); // ❌ 실패해야 정상
  });
  it("should fail if order data is modified", async () => {
    const [signer] = await ethers.getSigners();

    const order = {
      from: {
        wallet: signer.address,
        name: "Alice"
      },
      to: {
        wallet: "0x000000000000000000000000000000000000dEaD",
        name: "Bob"
      },
      amount: ethers.parseEther("1"),
      nonce: 1
    };

    const domain = {
      name: "NestedPermitApp",
      version: "1",
      chainId,
      verifyingContract: await contract.getAddress()
    };

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
      ]
    };

    const signature = await signer.signTypedData(domain, types, order);

    // 🔧 order 내용 살짝 변경 (name 변경)
    const tamperedOrder = {
      ...order,
      from: {
        ...order.from,
        name: "Evil Alice" // 😈 살짝만 바꿈
      }
    };

    const isValid = await contract.verify(tamperedOrder, signature);
    expect(isValid).to.equal(false); // ❌ 실패해야 정상
  });
  it("should accept EIP-1271 contract wallet signature", async () => {
    const [signer] = await ethers.getSigners();
  
    const EIP1271Wallet = await ethers.getContractFactory("EIP1271WalletMock");
    const walletContract = await EIP1271Wallet.deploy(signer.address);
    await walletContract.waitForDeployment();

    let walletAddress = await walletContract.getAddress()
  
    const order = {
      from: {
        wallet: walletAddress, // 컨트랙트 주소!
        name: "Alice"
      },
      to: {
        wallet: "0x000000000000000000000000000000000000dEaD",
        name: "Bob"
      },
      amount: ethers.parseEther("1"),
      nonce: 1
    };
  
    const domain = {
      name: "NestedPermitApp",
      version: "1",
      chainId,
      verifyingContract: await contract.getAddress()
    };

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
      ]
    };
  
    const signature = await signer.signTypedData(domain, types, order);
    const digest = ethers.TypedDataEncoder.hash(domain, types, order);
  
    const result = await walletContract.isValidSignature(digest, signature);
    expect(result).to.equal("0x1626ba7e"); // MAGICVALUE

    const isValid = await contract.verify(order, signature);
    expect(isValid).to.equal(true);

    const recovered = await contract.recoverSigner(order, signature);
    expect(recovered).to.equal(walletAddress);
  });
  it("should reject EIP-1271 signature if not signed by validSigner", async () => {
    const [signer, fakeSigner] = await ethers.getSigners();
  
    const EIP1271Wallet = await ethers.getContractFactory("EIP1271WalletMock");
    const walletContract = await EIP1271Wallet.deploy(fakeSigner.address); // ❌ 잘못된 signer
    await walletContract.waitForDeployment();

    let walletAddress = await walletContract.getAddress()
  
    const order = {
      from: {
        wallet: walletAddress,
        name: "Alice"
      },
      to: {
        wallet: "0x000000000000000000000000000000000000dEaD",
        name: "Bob"
      },
      amount: ethers.parseEther("1"),
      nonce: 1
    };
  
    const domain = {
      name: "NestedPermitApp",
      version: "1",
      chainId,
      verifyingContract: await contract.getAddress()
    };
  
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
      ]
    };
  
    const signature = await signer.signTypedData(domain, types, order);
    const digest = ethers.TypedDataEncoder.hash(domain, types, order);
  
    const result = await walletContract.isValidSignature(digest, signature);
    expect(result).to.not.equal("0x1626ba7e"); // ❌ MAGICVALUE 아님

    const isValid = await contract.verify(order, signature);
    expect(isValid).to.equal(false);

    const recovered = await contract.recoverSigner(order, signature);
    expect(recovered).to.not.equal(walletAddress);
  });
});
