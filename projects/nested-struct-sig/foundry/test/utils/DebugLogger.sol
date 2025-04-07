// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/console.sol";

library DebugLogger {
    function logBytes32(string memory label, bytes32 val) internal pure {
        console.log(string.concat(label, ":"));
        console.logBytes32(val);
    }

    function logAddress(string memory label, address val) internal pure {
        console.log(string.concat(label, ":"));
        console.logAddress(val);
    }

    function logUint(string memory label, uint256 val) internal pure {
        console.log(string.concat(label, ":"));
        console.logUint(val);
    }

    function logString(string memory label, string memory val) internal pure {
        console.log(string.concat(label, ": ", val));
    }

    function logBool(string memory label, bool val) internal pure {
        console.log(string.concat(label, ":"));
        console.logBool(val);
    }

    function section(string memory title) internal pure {
        console.log("-----------------------------");
        console.log(string.concat("** ", title));
        console.log("-----------------------------");
    }
}
