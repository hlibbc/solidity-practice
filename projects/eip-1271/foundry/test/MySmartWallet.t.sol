// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@contracts/MySmartWallet.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";


contract MySmartWalletTest is Test {
    // using ECDSA for bytes32;

    MySmartWallet wallet;

    // Hardhat default private keys
    uint256 signerPrivateKey = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    uint256 otherPrivateKey  = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;

    address signer;
    address other;

    string constant MESSAGE = "Hello, EIP-1271!";
    bytes4 constant MAGICVALUE = 0x1626ba7e;

    function setUp() public {
        signer = vm.addr(signerPrivateKey);
        other = vm.addr(otherPrivateKey);
        wallet = new MySmartWallet(signer);
    }

    function toEthSignedMessageHash(bytes32 hash) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
    }


    function testEOASignatureValid() public view {
        bytes32 rawHash = keccak256(bytes(MESSAGE));
        bytes32 digest = toEthSignedMessageHash(rawHash);

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPrivateKey, digest);
        bytes memory sig = abi.encodePacked(r, s, v);
        bytes4 result = wallet.isValidSignature(digest, sig);
        assertEq(result, MAGICVALUE);
    }

    function testEOASignatureInvalid() public view {
        bytes32 rawHash = keccak256(bytes(MESSAGE));
        bytes32 digest = toEthSignedMessageHash(rawHash);

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(otherPrivateKey, digest);
        bytes memory sig = abi.encodePacked(r, s, v);
        bytes4 result = wallet.isValidSignature(digest, sig);
        assertTrue(result != MAGICVALUE);
    }

    function testEIP712TypedDataSignatureValid() public view {
        uint256 chainId = block.chainid;

        // EIP-712 Domain Separator
        bytes32 DOMAIN_TYPEHASH = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
        bytes32 NAME_HASH = keccak256(bytes("MyDApp"));
        bytes32 VERSION_HASH = keccak256(bytes("1"));
        bytes32 DOMAIN_SEPARATOR = keccak256(abi.encode(
            DOMAIN_TYPEHASH,
            NAME_HASH,
            VERSION_HASH,
            chainId,
            address(wallet)
        ));

        // Struct hash for Order
        bytes32 ORDER_TYPEHASH = keccak256("Order(address from,address to,uint256 amount)");
        address from = signer;
        address to = other;
        uint256 amount = 100;

        bytes32 structHash = keccak256(abi.encode(
            ORDER_TYPEHASH,
            from,
            to,
            amount
        ));

        // Final digest per EIP-712
        bytes32 digest = keccak256(abi.encodePacked(
            "\x19\x01",
            DOMAIN_SEPARATOR,
            structHash
        ));

        // Sign with vm.sign
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPrivateKey, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        bytes4 result = wallet.isValidSignature(digest, sig);
        assertEq(result, MAGICVALUE);
    }
}
