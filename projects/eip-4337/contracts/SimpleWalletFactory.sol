// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./SimpleWallet.sol";
import "@account-abstraction/contracts/core/EntryPoint.sol";

contract SimpleWalletFactory {
    EntryPoint public entryPoint;
    event WalletCreated(address indexed wallet, address indexed owner);

    constructor(EntryPoint _entryPoint) {
        entryPoint = _entryPoint;
    }

    function createWallet(address owner, uint256 salt) public returns (SimpleWallet wallet) {
        wallet = new SimpleWallet{salt: bytes32(salt)}(owner, entryPoint);
        emit WalletCreated(address(wallet), owner);
    }

    function getWalletAddress(address owner, uint256 salt) public view returns (address) {
        bytes memory bytecode = abi.encodePacked(
            type(SimpleWallet).creationCode,
            abi.encode(owner, entryPoint)
        );
        bytes32 hash = keccak256(
            abi.encodePacked(bytes1(0xff), address(this), bytes32(salt), keccak256(bytecode))
        );
        return address(uint160(uint256(hash)));
    }

    // 새로운 함수 추가: Wallet 생성에 필요한 initCode 반환
    function getWalletInitCode(address owner, uint256 salt) public view returns (bytes memory) {
        return abi.encodePacked(
            type(SimpleWallet).creationCode,
            abi.encode(owner, entryPoint)
        );
    }
}
