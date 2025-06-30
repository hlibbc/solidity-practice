require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

// 환경 변수
const RPC_URL = process.env.RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const TOKEN_ADDRESS = process.env.ERC20ADDRESS;

// Provider, Signer
const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

// ABI
const artifactPath = path.resolve(
    __dirname,
    "../../artifacts/contracts/MyToken.sol/MyToken.json"
);
const abi = JSON.parse(fs.readFileSync(artifactPath, "utf8")).abi;

// Contract
const token = new ethers.Contract(TOKEN_ADDRESS, abi, wallet);

// 유틸 함수

/**
 * 특정 주소의 토큰 잔액 조회
 */
async function getBalance(address) {
    const decimals = await token.decimals();
    const raw = await token.balanceOf(address);
    return ethers.formatUnits(raw, decimals);
}

/**
 * 토큰 전송
 */
async function transfer(to, amountInEth) {
    const decimals = await token.decimals();
    const amount = ethers.parseUnits(amountInEth, decimals);
    const tx = await token.transfer(to, amount);
    return tx;
}

/**
 * 승인
 */
async function approve(spender, amountInEth) {
    const decimals = await token.decimals();
    const amount = ethers.parseUnits(amountInEth, decimals);
    const tx = await token.approve(spender, amount);
    return tx;
}

/**
 * allowance 확인
 */
async function getAllowance(owner, spender) {
    const raw = await token.allowance(owner, spender);
    const decimals = await token.decimals();
    return ethers.formatUnits(raw, decimals);
}

// 모듈 export
module.exports = {
    token,
    wallet,
    provider,
    abi,
    getBalance,
    transfer,
    approve,
    getAllowance,
};
