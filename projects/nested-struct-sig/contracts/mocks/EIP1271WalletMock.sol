// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/interfaces/IERC1271.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract EIP1271WalletMock is IERC1271 {
    address public validSigner;
    bytes4 public constant MAGICVALUE = 0x1626ba7e;

    constructor(address _signer) {
        validSigner = _signer;
    }

    function isValidSignature(bytes32 hash, bytes memory signature) public view override returns (bytes4) {
        address recovered = ECDSA.recover(hash, signature);
        if (recovered == validSigner) {
            return MAGICVALUE;
        } else {
            return 0xffffffff;
        }
    }
}
