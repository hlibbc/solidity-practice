// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {VRFConsumerBase} from "@bisonai/orakl-contracts/src/v0.1/VRFConsumerBase.sol";
import {IVRFCoordinator} from "@bisonai/orakl-contracts/src/v0.1/interfaces/IVRFCoordinator.sol";

interface IRandomnessReceiver {
    function onRandomnessReady(uint256 requestId, uint256 randomWord, bytes32 ctx) external;
}

contract VRFProxy is VRFConsumerBase {
    struct Pending {
        address caller;   // 요청한 컨트랙트
        bytes32 ctx;      // 요청자가 보낸 임의 컨텍스트(토큰ID, 주문ID 등 인코딩해서 사용)
    }

    event AllowedCallerSet(address caller, bool allowed);
    event RandomRequested(uint256 indexed requestId, address indexed caller, bytes32 ctx);
    event RandomFulfilled(uint256 indexed requestId, address indexed caller, uint256 word);

    IVRFCoordinator private immutable COORDINATOR;

    mapping(address => bool) public isAllowedCaller;
    mapping(uint256 => Pending) public pending;

    bytes32 public keyHash;
    uint32 public callbackGasLimit = 250000;
    uint32 public numWords = 1;

    address public owner;

    error NotOwner();
    error NotAllowedCaller();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyAllowed() {
        if (!isAllowedCaller[msg.sender]) revert NotAllowedCaller();
        _;
    }

    constructor(address coordinator) VRFConsumerBase(coordinator) {
        owner = msg.sender;
        COORDINATOR = IVRFCoordinator(coordinator);
    }

    function setOwner(address newOwner) external onlyOwner {
        owner = newOwner;
    }

    function setAllowedCaller(address caller, bool allowed) external onlyOwner {
        isAllowedCaller[caller] = allowed;
        emit AllowedCallerSet(caller, allowed);
    }

    function setParams(bytes32 _keyHash, uint32 _gasLimit, uint32 _numWords) external onlyOwner {
        keyHash = _keyHash;
        callbackGasLimit = _gasLimit;
        numWords = _numWords;
    }

    /// @notice 화이트리스트된 "요청자 컨트랙트"만 호출 가능
    /// @param ctx 요청자가 임의로 넣는 식별자(예: tokenId를 abi.encodePacked로)
    /// @param refundRecipient 남는 수수료 환불 받을 주소(보통 tx.origin 또는 treasury)
    function requestRandom(bytes32 ctx, address refundRecipient)
        external
        payable
        onlyAllowed
        returns (uint256 requestId)
    {
        requestId = COORDINATOR.requestRandomWords{value: msg.value}(
            keyHash,
            callbackGasLimit,
            numWords,
            refundRecipient
        );

        pending[requestId] = Pending({caller: msg.sender, ctx: ctx});
        emit RandomRequested(requestId, msg.sender, ctx);
    }

    function fulfillRandomWords(uint256 requestId, uint256[] memory randomWords) internal override {
        Pending memory p = pending[requestId];
        delete pending[requestId];

        uint256 word = randomWords[0];
        emit RandomFulfilled(requestId, p.caller, word);

        // 외부 콜백: 재진입 대비해 먼저 상태삭제 후 호출
        IRandomnessReceiver(p.caller).onRandomnessReady(requestId, word, p.ctx);
    }
}
