// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./MathLib.sol";

contract UsesMath {
    function double(uint256 x) external pure returns (uint256) {
        return MathLib.twice(x);
    }
}


