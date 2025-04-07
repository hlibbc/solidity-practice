// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/console.sol";
import "../../../contracts/NestedPermit.sol";
import {DebugLogger} from "../utils/DebugLogger.sol";

contract DebugNestedPermit is NestedPermit {
    using DebugLogger for *;

    function debugGetAll(Order memory order) public view returns (bytes32 digest) {
        bytes32 structHash = hashOrder(order);
        digest = _hashTypedDataV4(structHash);
        bytes32 domainSep = _domainSeparatorV4();

        DebugLogger.section("Digest Check");

        DebugLogger.logBytes32("structHash", structHash);
        DebugLogger.logBytes32("digest", digest);
        DebugLogger.logBytes32("domainSep", domainSep);
    }
}
