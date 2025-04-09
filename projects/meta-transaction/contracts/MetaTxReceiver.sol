// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/metatx/ERC2771Context.sol";

contract MetaTxReceiver is ERC2771Context {
    string public message;
    address public lastSender;

    constructor(address forwarder) ERC2771Context(forwarder) {}

    function setMessage(string calldata newMessage) external {
        message = newMessage;
        lastSender = _msgSender();
    }

    function isTrustedForwarder(address forwarder) public view override returns (bool) {
        return forwarder == _trustedForwarder;
    }

    address private immutable _trustedForwarder;

    function _msgSender() internal view override returns (address sender) {
        return super._msgSender();
    }

    function _msgData() internal view override returns (bytes calldata) {
        return super._msgData();
    }
}
