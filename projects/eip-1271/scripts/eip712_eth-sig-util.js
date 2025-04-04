/**
 * 실행방법: 
 * - eip-1271의 package.json에 script를 등록하거나
 * - pnpm --filter eip-1271 exec node scripts/eip712_eth-sig-util.js
 *   : 이렇게 실행시킬 경우, ethers 설치해야 한다. (pnpm --filter eip-1271 add ethers@6.13.5)
 * - 설치안하고도 실행시키려면 hardhat run 으로 실행해야 함
 *   : pnpm --filter eip-1271 exec hardhat run scripts/eip712_eth-sig-util.js
 */

const hre = require("hardhat");

const ethSigUtil = require("@metamask/eth-sig-util");

// ethers v6 utilities
const { Wallet } = require("ethers");

const signerPrivateKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const otherPrivateKey  = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

async function main() {
    try {
        let signer = new Wallet(signerPrivateKey, hre.ethers.provider);
        let other  = new Wallet(otherPrivateKey, hre.ethers.provider);

        const domain = {
            name: "MyDApp",
            version: "1",
            chainId: 31337,
            verifyingContract: "0xdF3e18d64BC6A983f673Ab319CCaE4f1a57C7097", // 임의의 주소
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

        console.log('signer address: ', signer.address)
        console.log('recovered address: ', recovered)
    } catch(error) {
        console.log(error)
    }
}
main();