// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@account-abstraction/contracts/core/BaseAccount.sol";
import "@account-abstraction/contracts/core/EntryPoint.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract SimpleWallet is BaseAccount {
    address public owner;
    IEntryPoint private immutable _entryPoint;

    modifier onlyOwner() {
        require(msg.sender == owner || msg.sender == address(entryPoint()), "Not owner or EntryPoint");
        _;
    }

    constructor(address _owner, EntryPoint entryPoint_) {
        owner = _owner;
        _entryPoint = entryPoint_;
    }

    function entryPoint() public view override returns (IEntryPoint) {
        return _entryPoint;
    }

    function execute(address dest, uint256 value, bytes calldata func) external override onlyOwner {
        (bool success,) = dest.call{value: value}(func);
        require(success, "Call failed");
    }

    receive() external payable {}

    function toEthSignedMessageHash(bytes32 hash) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
    }

    function _validateSignature(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash
    ) internal override virtual returns (uint256 validationData) {
        address recovered = ECDSA.recover(toEthSignedMessageHash(userOpHash), userOp.signature);
        return owner == recovered ? 0 : SIG_VALIDATION_FAILED;
    }
}
