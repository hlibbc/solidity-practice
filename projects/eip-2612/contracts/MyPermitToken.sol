// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

contract MyPermitToken is ERC20Permit {

    constructor()
        ERC20("MyPermitToken", "MPT")
        ERC20Permit("MyPermitToken")
    {
        _mint(msg.sender, 1000000 * 10 ** decimals());
    }

    bytes32 private constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    // for debugging eip-2612 signature
    function debugPermit_getAllHashes(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline
    ) public view returns (bytes32 structHash, bytes32 digest) {
        structHash = keccak256(abi.encode(PERMIT_TYPEHASH, owner, spender, value, nonces(owner), deadline));
        digest = _hashTypedDataV4(structHash);
    }

    function debugPermit_getSigner(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) public view returns(address) {
        bytes32 structHash = keccak256(abi.encode(PERMIT_TYPEHASH, owner, spender, value, nonces(owner), deadline));

        bytes32 hash = _hashTypedDataV4(structHash);

        return ECDSA.recover(hash, v, r, s);
    }
}
