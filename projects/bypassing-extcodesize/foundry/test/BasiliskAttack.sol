// test/BasiliskAttack.t.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../../contracts/Basilisk.sol";
import "../../contracts/Attacker.sol";

contract BasiliskAttackTest is Test {
    Basilisk private basilisk;
    Attacker private attacker;

    function setUp() public {
        // 1) Basilisk 배포
        basilisk = new Basilisk();
        // 2) Attacker 배포 (생성자에서 enter() 호출)
        attacker = new Attacker(address(basilisk));
    }

    function testSlay() public {
        // 3) 초기 상태: isSlain == false
        assertFalse(basilisk.isSlain(), unicode"초기 isSlain 상태가 false여야 합니다");

        // 4) attack() 호출 → slay()
        attacker.attack();

        // 5) 호출 후: isSlain == true
        assertTrue(basilisk.isSlain(), unicode"attack 후 isSlain 상태가 true여야 합니다");
    }
}
