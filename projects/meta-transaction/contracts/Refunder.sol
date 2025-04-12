// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract Refunder {
    event Refunded(address indexed sender, uint256 amount);

    receive() external payable {
        emit Refunded(msg.sender, msg.value);
    }

    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }
}
