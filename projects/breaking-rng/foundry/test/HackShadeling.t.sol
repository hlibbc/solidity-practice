// test/HackShadeling.t.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/Shadeling.sol";

contract HackShadelingTest is Test {
    Shadeling public shadeling;
    HackShadeling public hacker;

    function setUp() public {
        // 1) Shadeling 배포
        shadeling = new Shadeling();
        // 2) HackShadeling 배포 (Shadeling 주소 전달)
        hacker = new HackShadeling(address(shadeling));
    }

    function testHackShadelingSucceeds() public {
        // 3) isPredicted는 초기에 false여야 함
        bool initial = shadeling.isPredicted();
        assertEq(initial, false, "initial isPredicted must be false");

        // 4) hack() 호출 (같은 블록에서 block.timestamp를 사용해 _random() 예측)
        hacker.hack();

        // 5) isPredicted가 true로 바뀌었는지 확인
        bool afterHack = shadeling.isPredicted();
        assertEq(afterHack, true, "after hack(), isPredicted must be true");
    }
}
