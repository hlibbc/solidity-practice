// libs/MyToken.js
import { BrowserProvider, Contract, parseUnits } from "https://cdn.jsdelivr.net/npm/ethers@6.10.0/+esm";

const tokenAddress = "0x5FbDB2315678afecb367f032d93F642f64180aa3"; // 실제 배포 주소로 교체
const erc20Abi = [
    "function transfer(address to, uint amount) public returns (bool)",
    "function approve(address spender, uint amount) public returns (bool)",
    "function transferFrom(address from, address to, uint amount) public returns (bool)"
];

let provider, signer, tokenContract;

/**
 * 지갑 연결
 */
export async function connectWallet() {
    if (!window.ethereum) throw new Error("MetaMask가 설치되어 있지 않습니다.");

    provider = new BrowserProvider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    signer = await provider.getSigner();

    tokenContract = new Contract(tokenAddress, erc20Abi, signer);
    return await signer.getAddress();
}

/**
 * 전송 함수 (transfer)
 */
export async function transferLib(to, amountRaw) {
    const amount = parseUnits(amountRaw);
    const tx = await tokenContract.transfer(to, amount);
    return tx.hash;
}

/**
 * approve 후 transferFrom 실행
 */
export async function approveAndTransferLib(to, amountRaw) {
    const amount = parseUnits(amountRaw);
    const from = await signer.getAddress();
    await tokenContract.approve(from, amount);
    const tx = await tokenContract.transferFrom(from, to, amount);
    return tx.hash;
}
