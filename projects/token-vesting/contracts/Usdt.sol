// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title StableCoin Template Contract
 * @notice StableCoin template 컨트랙트
 * @dev EIP-2612 permit 기능을 지원하는 ERC20 토큰
 * decimal: 6
 * @author hlibbc
 */
contract StableCoin is ERC20Permit, Ownable {
    // def. CONSTANT
    uint256 public constant INITIAL_SUPPLY = 10_000_000_000 * 10 ** 6; /// 100억 STT

    /**
     * @notice SttPermit 컨트랙트 생성자
     * @dev 초기 공급량을 소유자에게 민팅
     */
    constructor() 
        ERC20(unicode"USD₮0", "USDT") 
        ERC20Permit(unicode"USD₮0") 
        Ownable(msg.sender) 
    {
        _mint(msg.sender, INITIAL_SUPPLY);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}
