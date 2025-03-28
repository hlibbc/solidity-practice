// SPDX-License-Identifier: MIT
pragma solidity ^0.8.14;

// Event Subscription and Real-Time Updates
interface IEventSubscriber {
    function handleTransferEvent(address from, address to, uint256 value)
        external;
}

/**
 * @dev transfer 함수가 있는 컨트랙트 (ex. ERC20, 721, 1155, ..)에서 
 * 하기의 컨트랙트를 상속받은 후, transfer 함수 내부에서 super.transfer를 호출하면
 * 토큰전송이 일어날 때마다 구독자들에게 토큰전송 이벤트가 실시간으로 전달되게 된다.
 *
 * 참조: https://solidity-by-example.org/events-advanced/
 *
 * 구독자가 너무 많으면 max-gas-limit에 걸릴 수 있다.
 * max-gas-limit에 걸리지 않더라도 이같은 방식은 gas 소모에 있어 매우 비효율적이다.
 * offchain 상에서 scanning을 통한 정보수집이 더욱 현식적인 방법이다.
 *
 * 즉, EventSubscription 컨트랙트는 생산 환경에서 바로 사용하기보다는, 
 * 이벤트 구독 패턴의 원리를 이해하고 이후 실제 상황에 맞게 최적화할 때 
 * 고려해야 할 요소들을 인식하도록 돕기 위한 교육적 예제로 볼 수 있다.
 */
contract EventSubscription {
    event LogTransfer(address indexed from, address indexed to, uint256 value);

    mapping(address => bool) public subscribers;
    address[] public subscriberList;

    function subscribe() public {
        require(!subscribers[msg.sender], "Already subscribed");
        subscribers[msg.sender] = true;
        subscriberList.push(msg.sender);
    }

    function unsubscribe() public {
        require(subscribers[msg.sender], "Not subscribed");
        subscribers[msg.sender] = false;
        for (uint256 i = 0; i < subscriberList.length; i++) {
            if (subscriberList[i] == msg.sender) {
                subscriberList[i] = subscriberList[subscriberList.length - 1];
                subscriberList.pop();
                break;
            }
        }
    }

    function transfer(address to, uint256 value) public {
        emit LogTransfer(msg.sender, to, value);
        for (uint256 i = 0; i < subscriberList.length; i++) {
            IEventSubscriber(subscriberList[i]).handleTransferEvent(
                msg.sender, to, value
            );
        }
    }
}
