/* eslint-disable no-undef */
// SPDX-License-Identifier: MIT
const { ethers } = require("hardhat");

async function main() {
    const [deployer, user, other] = await ethers.getSigners();
    console.log("Deployer:", deployer.address);

    // 1) Deploy MyNFT and mint to `user`
    const NFT = await ethers.getContractFactory("MyNFT");
    const nft = await NFT.deploy();
    await nft.waitForDeployment();
    const nftAddr = await nft.getAddress();

    const mintTx = await nft.mint(user.address);
    await mintTx.wait();
    const nextId = await nft.nextId(); // BigInt
    const tokenId = nextId - 1n;

    console.log("MyNFT:", nftAddr, "tokenId:", tokenId.toString());

    // 2) Deploy ERC6551Account implementation
    const Impl = await ethers.getContractFactory("ERC6551Account");
    const impl = await Impl.deploy();
    await impl.waitForDeployment();
    const implAddr = await impl.getAddress();
    console.log("Account Impl:", implAddr);

    // 3) Deploy Registry
    const Reg = await ethers.getContractFactory("ERC6551Registry");
    const reg = await Reg.deploy();
    await reg.waitForDeployment();
    const regAddr = await reg.getAddress();
    console.log("Registry:", regAddr);

    // 4) Predict account address
    const { chainId } = await ethers.provider.getNetwork();
    const salt = ethers.keccak256(ethers.toUtf8Bytes("DEMO_SALT_V1"));

    const predicted = await reg.account(
        implAddr,
        salt,
        chainId,
        nftAddr,
        tokenId
    );
    console.log("Predicted TBA:", predicted);

    // 5) Create account
    const createTx = await reg.createAccount(
        implAddr,
        salt,
        chainId,
        nftAddr,
        tokenId
    );
    await createTx.wait();
    const tba = predicted;
    console.log("Created TBA:", tba);

    // 6) Verify token() tuple from TBA
    const tbaAcc = await ethers.getContractAt("ERC6551Account", tba);
    const tokenTuple = await tbaAcc.token();
    console.log("token():", tokenTuple);

    // 7) Verify footer by slicing runtime bytecode (manual extcodecopy equivalent)
    const code = await ethers.provider.getCode(tba); // 0x...
    const hex = code.startsWith("0x") ? code.slice(2) : code;

    // footer: offset 0x4d (77 bytes), length 0x60 (96 bytes)
    const start = 77 * 2;
    const end = start + 96 * 2;
    const footerHex = "0x" + hex.slice(start, end);
    console.log("Footer(hex):", footerHex);

    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    const [fChainId, fTokenContract, fTokenId] = abiCoder.decode(
        ["uint256", "address", "uint256"],
        footerHex
    );
    console.log("Decoded footer =>", {
        fChainId: fChainId.toString(),
        fTokenContract,
        fTokenId: fTokenId.toString(),
    });

    // 8) Fund TBA and call execute() as NFT owner (`user`)
    await deployer.sendTransaction({ to: tba, value: ethers.parseEther("0.1") });
    const bal1 = await ethers.provider.getBalance(tba);
    console.log("TBA balance before:", ethers.formatEther(bal1));

    // 대신 별도 Target.sol 없이, MyNFT의 view 함수에 call (supportsInterface)
    // ERC721 인터페이스ID: 0x80ac58cd
    const iface = new ethers.Interface(["function supportsInterface(bytes4) view returns (bool)"]);
    const data = iface.encodeFunctionData("supportsInterface", ["0x80ac58cd"]);

    const tbaFromUser = tbaAcc.connect(user);
    const execTx = await tbaFromUser.execute(
        nftAddr,
        0n,         // value
        data,
        0           // operation = CALL
    );
    await execTx.wait();

    const bal2 = await ethers.provider.getBalance(tba);
    console.log("TBA balance after:", ethers.formatEther(bal2));

    // 9) Non-owner should revert
    try {
        const tbaFromOther = tbaAcc.connect(other);
        await (await tbaFromOther.execute(nftAddr, 0n, data, 0)).wait();
        console.log("ERROR: non-owner executed (should revert)");
    } catch (e) {
        console.log("OK: non-owner reverted");
    }

    console.log("Demo done.");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
