// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ERC2771Context } from "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import { IERC20Permit } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";

interface ITokenVesting {
    struct PermitData { uint256 value; uint256 deadline; uint8 v; bytes32 r; bytes32 s; }
    function buyBox(uint256 amount, string calldata refCode, PermitData calldata p) external;
}

contract PermitAndBuyWrapper is ERC2771Context {
    constructor(address trustedForwarder) ERC2771Context(trustedForwarder) {}

    function permitAndBuyBox(
        address usdt,
        address vesting,
        uint256 amount,
        string calldata refCode,
        ITokenVesting.PermitData calldata p
    ) external {
        address owner = _msgSender(); // ERC2771: 원 서명자
        // 1) permit: owner → spender = vesting
        IERC20Permit(usdt).permit(owner, vesting, p.value, p.deadline, p.v, p.r, p.s);

        // 2) 이미 allowance 확보됨 → 빈 permit으로 buyBox
        ITokenVesting.PermitData memory empty;
        ITokenVesting(vesting).buyBox(amount, refCode, empty);
    }
}
