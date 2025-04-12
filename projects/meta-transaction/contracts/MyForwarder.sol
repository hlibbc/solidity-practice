// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";

contract MyForwarder is ERC2771Forwarder {
    constructor() ERC2771Forwarder("MyForwarder") {}

    // MyForwarder.sol
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
