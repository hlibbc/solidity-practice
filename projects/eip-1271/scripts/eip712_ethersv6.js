/**
 * 실행방법: 
 * - eip-1271의 package.json에 script를 등록하거나
 * - pnpm --filter eip-1271 exec node scripts/eip712_ethersv6.js
 *   : 이렇게 실행시킬 경우, ethers 설치해야 한다. (pnpm --filter eip-1271 add ethers@6.13.5)
 * - 설치안하고도 실행시키려면 hardhat run 으로 실행해야 함
 *   : pnpm --filter eip-1271 exec hardhat run scripts/eip712_ethersv6.js
 */

const hre = require("hardhat");

// ethers v6 utilities
const { TypedDataEncoder, Wallet, hexlify, concat, getBytes } = require("ethers");

const signerPrivateKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const otherPrivateKey  = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

async function main() {
    try {
        let signer = new Wallet(signerPrivateKey, hre.ethers.provider);
        let other  = new Wallet(otherPrivateKey, hre.ethers.provider);

        let chainId = (await hre.ethers.provider.getNetwork()).chainId;

        const domain = {
            name: "MyDApp",
            version: "1",
            chainId,
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
        const signerAddress = await signer.getAddress();
        const otherAddress  = await other.getAddress();
        const value = {
            from: signerAddress,
            to: otherAddress,
            amount: 100,
        };
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

        console.log('signer address: ', signerAddress)
        console.log('recovered address: ', recovered)
    } catch(error) {
        console.log(error)
    }
}
main();