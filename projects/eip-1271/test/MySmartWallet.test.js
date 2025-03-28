const { expect } = require("chai");
const hre = require("hardhat");

// ethers v6 utilities
const { hashMessage, TypedDataEncoder, Wallet } = require("ethers");
const ethSigUtil = require("@metamask/eth-sig-util");

function fixV(signature) {
    // signature는 65바이트, 끝 1바이트가 v
    const sigBuf = Buffer.from(signature.slice(2), 'hex');
    if (sigBuf[64] < 27) {
      sigBuf[64] += 27;
    }
    return '0x' + sigBuf.toString('hex');
  }
  

describe("EIP-1271 Smart Wallet with EIP-712 Signature (ethers v6)", function () {
  let walletContract;
  let owner, other;
  let signer;
  const MAGICVALUE = "0x1626ba7e";

  // Hardhat 내장 테스트 계정 0번의 private key
  const ownerPrivateKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

  beforeEach(async function () {
    [owner, other] = await hre.ethers.getSigners();

    // signer는 ethers@6 방식으로 생성
    signer = new Wallet(ownerPrivateKey, hre.ethers.provider);

    const WalletFactory = await hre.ethers.getContractFactory("MySmartWallet");
    walletContract = await WalletFactory.deploy(signer.address);
    await walletContract.waitForDeployment(); // ethers v6에서는 waitForDeployment
  });

  it("should validate EOA signature via isValidSignature", async function () {
    const message = "Hello, EIP-1271!";
    const messageHash = hashMessage(message); // ethers v6 함수
    const signature = await signer.signMessage(message);

    const result = await walletContract.isValidSignature(messageHash, signature);
    expect(result).to.equal(MAGICVALUE);
  });

  it("should reject signature from non-owner", async function () {
    const message = "Invalid signer";
    const messageHash = hashMessage(message);
    const signature = await other.signMessage(message); // 다른 사람이 서명

    const result = await walletContract.isValidSignature(messageHash, signature);
    expect(result).to.not.equal(MAGICVALUE);
  });

  it("should validate EIP-712 typed data signature", async function () {
    const chainId = (await hre.ethers.provider.getNetwork()).chainId;

    const domain = {
      name: "MyDApp",
      version: "1",
      chainId,
      verifyingContract: await walletContract.getAddress(), // ethers v6
    };

    const types = {
      Order: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "amount", type: "uint256" },
      ],
    };

    const value = {
      from: await signer.getAddress(),
      to: await other.getAddress(),
      amount: 100,
    };

    console.log(signer.getAddress())
    console.log(other.getAddress())

    console.log("✅ signer.getAddress():", await signer.getAddress());
    console.log("✅ value.from:", value.from);
    console.log("✅ value.to:", value.to);
    console.log("✅ TypedData:", { domain, types, value });

    walletContract.once("DebugHash", (hash) => {
        console.log("🧩 Contract received hash:", hash);
    });
    
    walletContract.once("DebugRecovered", (signer) => {
        console.log("🧩 Recovered signer in contract:", signer);
    });


    // signTypedData (Metamask util 사용)
    let signature = ethSigUtil.signTypedData({
      privateKey: Buffer.from(ownerPrivateKey.slice(2), "hex"),
      data: {
        types: { EIP712Domain: [], ...types },
        domain,
        primaryType: "Order",
        message: value,
      },
      version: "V4",
    });
    // signature = fixV(signature); // ✨ 이 줄 추가!

    // Create digest using ethers@6
    const digest = TypedDataEncoder.hash(domain, types, value);

    const result = await walletContract.isValidSignature(digest, signature);
    expect(result).to.equal(MAGICVALUE);
  });
});
