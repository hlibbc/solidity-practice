// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/metatx/ERC2771Context.sol";

contract MetaTxReceiver is ERC2771Context {
    string public message;
    address public lastSender;

    event MessageUpdated(string message, address sender);
    event MetaTxDebug(address realSender, bytes fullData);

    constructor(address forwarder) ERC2771Context(forwarder) {}

    function setMessage(string calldata newMessage) external {
        message = newMessage;
        lastSender = _msgSender();
        emit MetaTxDebug(_msgSender(), msg.data); // 🪵 디버깅 로그
        emit MessageUpdated(newMessage, _msgSender());
    }

    function _msgSender() internal view override returns (address sender) {
        return super._msgSender();
    }

    function _msgData() internal view override returns (bytes calldata) {
        return super._msgData();
    }
}
