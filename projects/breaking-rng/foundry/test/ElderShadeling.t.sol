// test/ElderShadeling.t.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../../contracts/ElderShadeling.sol";

contract ElderShadelingTest is Test {
    ElderShadeling elder;

    function setUp() public {
        elder = new ElderShadeling();
    }

    function testPredictBecomesTrueAfter256Blocks() public {
        // 1) 현재 블록 번호를 N으로 고정
        vm.roll(100);  // 임의로 100번 블록으로 설정
        uint256 commitBlock = block.number; // = 100

        // 2) commitPrediction(0x00...00) 호출 → blockNumber = 100 저장
        bytes32 zeroBytes = bytes32(0);
        elder.commitPrediction(zeroBytes);

        // 3) 블록 번호를 N+258 (=358)로 롤링
        //    → 이제 원래 N+1 (=101) 블록은 256블록 이전으로 밀려나 blockhash(101) == 0
        vm.roll(commitBlock + 258); // = 100 + 258 = 358

        // 4) checkPrediction() 호출 → isPredicted가 true가 되는지 확인
        elder.checkPrediction();
        assertEq(elder.isPredicted(), true);
    }
}
