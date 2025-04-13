const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AAStack Deployer Test", function () {
  let entryPoint;
  let walletFactory;
  let paymaster;
  let deployer;
  let user;
  let relayer;
  let userKey = 12345n;
  let signer;

  const addressZero = "0x0000000000000000000000000000000000000000";
  const hashZero = "0x0000000000000000000000000000000000000000000000000000000000000000"

  beforeEach(async function () {
    // Set up accounts
    [deployer, user, relayer, signer] = await ethers.getSigners();

    const AAStackDeployer = await ethers.getContractFactory("AAStackDeployer");
    const aaStack = await AAStackDeployer.deploy(await deployer.getAddress()); // signer as verifier for demo
    await aaStack.waitForDeployment();

    const [entryPointAddress, walletFactoryAddress, paymasterAddress] = await aaStack.getAddresses();
    
    // Get deployed contract addresses
    entryPoint = await ethers.getContractAt("EntryPoint", entryPointAddress);
    walletFactory = await ethers.getContractAt("SimpleWalletFactory", walletFactoryAddress);
    paymaster = await ethers.getContractAt("SimplePaymaster", paymasterAddress);
  });

  it("should deploy the EntryPoint, WalletFactory, and Paymaster contracts", async function () {
    expect(await entryPoint.getAddress()).to.not.equal(addressZero);
    expect(await walletFactory.getAddress()).to.not.equal(addressZero);
    expect(await paymaster.getAddress()).to.not.equal(addressZero);
  });

  it("should deploy a new wallet using the WalletFactory", async function () {
    const salt = 1234; // Use a random salt for wallet deployment
    const tx = await walletFactory.createWallet(await user.getAddress(), salt);
    const receipt = await tx.wait();

    // Log the events to check if WalletCreated event is fired
    // console.log("Event receipt logs:", receipt.logs);  // This will print the array of logs

    // Ensure that the WalletCreated event is emitted by checking receipt.logs
    for (let i = 0; i < receipt.logs.length; i++) {
        const log = receipt.logs[i];
        try {
            const parsedLog = await walletFactory.interface.parseLog(log);
            if (parsedLog.name === "WalletCreated") {
                const walletAddress = parsedLog.args[0]; // Extract wallet address from the event args
                // console.log("WalletCreated event detected, wallet address:", walletAddress);
                expect(walletAddress).to.not.be.undefined;

                // Check if the wallet was deployed successfully
                const wallet = await ethers.getContractAt("SimpleWallet", walletAddress);
                expect(await wallet.owner()).to.equal(await user.getAddress());
            }
        } catch (err) {
            console.log("Error parsing log:", err);
        }
    }
  });

  it("should accept a user operation and be processed by the Paymaster", async function () {
    // Create a new wallet for the user
    const salt = 1234;
    const tx = await walletFactory.createWallet(await user.getAddress(), salt);
    const receipt = await tx.wait();
  
    // Log the event to get the wallet address
    let walletAddress;
    for (let i = 0; i < receipt.logs.length; i++) {
      const log = receipt.logs[i];
      try {
        const parsedLog = await walletFactory.interface.parseLog(log);
        if (parsedLog.name === "WalletCreated") {
          walletAddress = parsedLog.args[0]; // Get the wallet address from the event
          expect(walletAddress).to.not.be.undefined;
  
          // Check if the wallet is deployed and has the correct owner
          const wallet = await ethers.getContractAt("SimpleWallet", walletAddress);
          expect(await wallet.owner()).to.equal(await user.getAddress());
        }
      } catch (err) {
        console.log("Error parsing log:", err);
      }
    }
  
    // Check if the wallet is already deployed in EntryPoint, before sending user operation
    const currentNonce = await entryPoint.getNonce(walletAddress, userKey);
    expect(currentNonce.toString()).to.equal("0", "The account has already been constructed!");
  
    // Create the user operation (userOp) for the transaction
    const userOp = {
      sender: walletAddress,  // Use the deployed wallet address
      nonce: currentNonce,  // Use the fetched nonce for the user
      initCode: await walletFactory.getWalletInitCode(await user.getAddress(), salt),  // Use the actual wallet init code
      callData: "0x",  // Placeholder for any call data
      accountGasLimits: hashZero,  // Default value
      preVerificationGas: 200000,  // Correct gas value
      gasFees: hashZero,  // Default value
      paymasterAndData: "0x",  // Placeholder
      signature: "0x",  // Signature will be filled after signing
    };
  
    // Sign the user operation
    const domain = {
      name: "AAStack",
      version: "1",
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: await entryPoint.getAddress(),
    };
  
    const types = {
      PackedUserOperation: [
        { name: "sender", type: "address" },
        { name: "nonce", type: "uint256" },
        { name: "initCode", type: "bytes" },
        { name: "callData", type: "bytes" },
        { name: "accountGasLimits", type: "bytes32" },
        { name: "preVerificationGas", type: "uint256" },
        { name: "gasFees", type: "bytes32" },
        { name: "paymasterAndData", type: "bytes" },
        { name: "signature", type: "bytes" },
      ],
    };
  
    const signature = await signer.signTypedData(domain, types, userOp);
    userOp.signature = signature;  // Add the signature to the user operation
  
    // Process the user operation using the EntryPoint
    await entryPoint.connect(relayer).handleOps([userOp], await paymaster.getAddress());
  
    // Check the balance after operation (for testing purposes)
    const balance = await ethers.provider.getBalance(await user.getAddress());
    console.log("User's new balance:", ethers.utils.formatEther(balance));
    expect(balance).to.be.above(ethers.parseUnits("0.1", 18));  // Check if the balance increased
  });
  
});

