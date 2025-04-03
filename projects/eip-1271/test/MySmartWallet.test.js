const { expect } = require("chai");
const hre = require("hardhat");

// ethers v6 utilities
const { hashMessage, TypedDataEncoder, Wallet, hexlify, concat, getBytes } = require("ethers");
const ethSigUtil = require("@metamask/eth-sig-util");


describe("EIP-1271 Smart Wallet with EIP-712 Signature (ethers v6)", function () {
  let walletContract;
  let signer, other;
  const MAGICVALUE = "0x1626ba7e";

  // // Hardhat 내장 테스트 계정 0번의 private key
  const signerPrivateKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
  const otherPrivateKey  = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

  before(async function () {
    signer = new Wallet(signerPrivateKey, hre.ethers.provider);
    other  = new Wallet(otherPrivateKey, hre.ethers.provider);
    const WalletFactory = await hre.ethers.getContractFactory("MySmartWallet");
    walletContract = await WalletFactory.deploy(signer.address);
    await walletContract.waitForDeployment();
    // console.log("🔍 signer address:", await signer.getAddress());
    // console.log("🔍 other address:",  await other.getAddress());
    // console.log("🔍 walletContract address:", await walletContract.getAddress());
  });

  it("should validate EOA signature via isValidSignature", async function () {
    const message = "Hello, EIP-1271!";
    const digest = hashMessage(message);
    const signature = await signer.signMessage(message);
    const result = await walletContract.isValidSignature(digest, signature);
    expect(result).to.equal(MAGICVALUE);
  });
  it("should reject signature from non-owner", async function () {
    const message = "Hello, EIP-1271!";
    const digest = hashMessage(message);
    const signature = await other.signMessage(message);
    const result = await walletContract.isValidSignature(digest, signature);
    expect(result).to.not.equal(MAGICVALUE);
  });

  it("should validate EIP-712 typed data signature", async function () {
    const chainId = (await hre.ethers.provider.getNetwork()).chainId;
    const domain = {
      name: "MyDApp",
      version: "1",
      chainId,
      verifyingContract: await walletContract.getAddress(),
    };

    const types = {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
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
    // walletContract.once("DebugHash", (hash) => {
    //     console.log("🧩 Contract received hash:", hash);
    // });
    
    // walletContract.once("DebugRecovered", (signer) => {
    //     console.log("🧩 Recovered signer in contract:", signer);
    // });
    // const rawSignature = ethSigUtil.signTypedData({
    //   privateKey: Buffer.from(signerPrivateKey.slice(2), "hex"),
    //   data: {
    //     types,
    //     domain,
    //     primaryType: "Order",
    //     message: value,
    //   },
    //   version: "V4",
    // });
    // console.log('rawSignature: ', rawSignature)

    const wallet = new Wallet(signerPrivateKey, hre.ethers.provider);
    const digest = TypedDataEncoder.hash(domain, { Order: types.Order }, value);

    // const signature = await wallet.signMessage(digest);
    const signature = wallet.signingKey.sign(digest)
    
    // console.log('signature: ', signature)
    const r = signature.r;
    const s = signature.s;
    const v = 27 + signature.yParity; // yParity: 0 or 1 → v: 27 or 28

    // r + s + v 조합해서 rawSignature 생성
    // const compRawSignature = hexlify(concat([r, s, [v]])); // <-- ✅ 여기가 핵심
    const compRawSignature = hexlify(concat([
      getBytes(r),
      getBytes(s),
      Uint8Array.from([v]) // ✅ v를 1바이트짜리 BytesLike로 변환
    ]));

    console.log('compRawSignature: ', compRawSignature)
    
    // signature = fixV(signature); // ✨ 이 줄 추가!

    // Create digest using ethers@6
    // const digest = TypedDataEncoder.hash(domain, types, value);
    // const digest = TypedDataEncoder.hash(domain, orderTypes, value);

    const result = await walletContract.isValidSignature(digest, compRawSignature);
    expect(result).to.equal(MAGICVALUE);
  });
  it("should verify EIP-712 signature using ethers.js", async function () {
    let chainId = (await hre.ethers.provider.getNetwork()).chainId;
  
    const domain = {
      name: "MyDApp",
      version: "1",
      chainId,
      verifyingContract: await walletContract.getAddress(),
    };
  
    const types = {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      Order: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "amount", type: "uint256" },
      ],
    };
    const signerAddress = await signer.getAddress();
    const otherAddress = await other.getAddress();
    const value = {
      from: signerAddress,
      to: otherAddress,
      amount: 100,
    };
    // EIP-712 서명 생성
    // const rawSignature = ethSigUtil.signTypedData({
    //   privateKey: Buffer.from(signerPrivateKey.slice(2), "hex"),
    //   data: {
    //     types,
    //     domain,
    //     primaryType: "Order",
    //     message: value,
    //   },
    //   version: "V4",
    // });
    const wallet = new Wallet(signerPrivateKey, hre.ethers.provider);
    const digest = TypedDataEncoder.hash(domain, { Order: types.Order }, value);
    const signature = wallet.signingKey.sign(digest)
    const r = signature.r;
    const s = signature.s;
    const v = 27 + signature.yParity; // yParity: 0 or 1 → v: 27 or 28
    const rawSignature = hexlify(concat([
      getBytes(r),
      getBytes(s),
      Uint8Array.from([v]) // ✅ v를 1바이트짜리 BytesLike로 변환
    ]));
    
    const recovered = hre.ethers.verifyTypedData(domain, { Order: types.Order }, value, rawSignature);
    
    console.log("✅ Recovered address via ethers.verifyTypedData:", recovered);
    console.log("✅ Expected signer address:", signerAddress);
  
    expect(recovered).to.equal(signerAddress);
  });
  it("should verify EIP-712 signature using eth-sig-utils", async () => {
    const domain = {
      name: "MyDApp",
      version: "1",
      chainId: 31337,
      verifyingContract: await walletContract.getAddress(),
    };

    const types = {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      Order: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "amount", type: "uint256" },
      ],
    };
    const value = {
      from: signer.address,
      to: other.address,
      amount: 100,
    };

    const rawSignature = ethSigUtil.signTypedData({
      privateKey: Buffer.from(signerPrivateKey.slice(2), "hex"),
      data: {
        types,
        domain,
        primaryType: "Order",
        message: value,
      },
      version: "V4",
    });

    const recovered = ethSigUtil.recoverTypedSignature({
      data: {
        types,
        domain,
        primaryType: "Order",
        message: value,
      },
      signature: rawSignature,
      version: "V4",
    });

    expect(recovered.toLowerCase()).to.equal(signer.address.toLowerCase());
  });
});