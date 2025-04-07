// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../NestedPermit.sol";

contract DebugNestedPermit is NestedPermit {
    function getStructHash(Order memory order) public pure returns (bytes32) {
        return hashOrder(order);
    }

    function getDigest(Order memory order) public view returns (bytes32) {
        return _hashTypedDataV4(hashOrder(order));
    }

    function getDomainSeparator() public view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
