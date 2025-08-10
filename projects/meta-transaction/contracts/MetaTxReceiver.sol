// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/metatx/ERC2771Context.sol";

contract MetaTxReceiver is ERC2771Context {
    string public message;
    address public lastSender;

    event MessageUpdated(string message, address sender);
    event MetaTxDebug(address realSender, bytes fullData);

    constructor(address forwarder) ERC2771Context(forwarder) {}

    function setMessage(string calldata newMessage) external payable {
        if(keccak256(bytes(newMessage)) == keccak256(bytes("revert1"))) {
            revert("revert1");
        } else if(keccak256(bytes(newMessage)) == keccak256(bytes("revert2"))) {
            revert("revert2");
        } else if(keccak256(bytes(newMessage)) == keccak256(bytes("revert3"))) {
            revert("revert3");
        } else if(keccak256(bytes(newMessage)) == keccak256(bytes("revert4"))) {
            revert("revert4");
        } else if(keccak256(bytes(newMessage)) == keccak256(bytes("revert5"))) {
            revert("revert5");
        } else if(keccak256(bytes(newMessage)) == keccak256(bytes("revert6"))) {
            revert("revert6");
        } else if(keccak256(bytes(newMessage)) == keccak256(bytes("revert7"))) {   
            revert("revert7");
        } else if(keccak256(bytes(newMessage)) == keccak256(bytes("revert8"))) {
            revert("revert8");
        } else {
            message = newMessage;
            lastSender = _msgSender();  
            emit MetaTxDebug(_msgSender(), msg.data);
            emit MessageUpdated(newMessage, _msgSender());
        }
    }
    
    function _msgSender() internal view override returns (address sender) {
        return super._msgSender();
    }

    function _msgData() internal view override returns (bytes calldata) {
        return super._msgData();
    }
} 
