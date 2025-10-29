// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MyToken contract
 * @notice ERC20 기본 컨트랙트
 * @dev 초기발행량 1만개 fix
 * @author hlibbc
 */
contract MyToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        _mint(msg.sender, 10000 * 10 ** decimals());
    }
}
