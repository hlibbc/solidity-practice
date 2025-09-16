// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title Token contract
 * @notice ERC20 기본 컨트랙트
 * @dev 초기발행량 1만개 fix
 * @author hlibbc
 */
contract Token is ERC20 {
    constructor() ERC20("Token", "TTT") {
        _mint(msg.sender, 1000000000 * 10 ** decimals()); // 10억개
    }
}
