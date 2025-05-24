// SPDX-License-Identifier: MIT
pragma solidity ^0.8.14;

// Event-Driven Architecture
/**
 * @dev EventDrivenArchitecture는 실제 전송 로직과 별도로 이벤트를 통해 
 * 중요한 작업 단계(예: 전송 시작, 전송 확인)를 기록하고 알림을 주기 위한 패턴입니다. 
 * 단독으로 사용되기보다는, 시스템의 특정 부분에서 상태 변화나 중요한 사건을 외부에 알리고, 
 * 이로 인해 추가적인 처리가 이루어지도록 설계할 때 유용합니다.
 *
 * 참조: https://solidity-by-example.org/events-advanced/
 *
 *
 * 감사와 투명성 등 중요한 정보를 기록하기 위한 용도라고 봐도 
 * 옛날 원시적인 멀티시그 방식처럼 매우 비효율적이다.
 * 그냥 교육적 예제로 봐야 할 듯
 */
contract EventDrivenArchitecture {
    event TransferInitiated(
        address indexed from, address indexed to, uint256 value
    );
    event TransferConfirmed(
        address indexed from, address indexed to, uint256 value
    );

    mapping(bytes32 => bool) public transferConfirmations;

    function initiateTransfer(address to, uint256 value) public {
        emit TransferInitiated(msg.sender, to, value);
        // ... (initiate transfer logic)
    }

    function confirmTransfer(bytes32 transferId) public {
        require(
            !transferConfirmations[transferId], "Transfer already confirmed"
        );
        transferConfirmations[transferId] = true;
        emit TransferConfirmed(msg.sender, address(this), 0);
        // ... (confirm transfer logic)
    }
}