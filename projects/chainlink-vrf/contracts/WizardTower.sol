// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { VRFConsumerBaseV2Plus } 
    from "@chainlink/contracts/src/v0.8/vrf/dev/VRFConsumerBaseV2Plus.sol";
import { VRFV2PlusClient } 
    from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";

contract WizardTower is VRFConsumerBaseV2Plus {

    address private constant COORDINATOR = 0x9DdfaCa8183c41ad55329BdeeD9F6A8d53168B1B;
    
    uint32 public floorsClimbed;
    uint256[] public randomResults; // ✅ VRF 결과 저장

    constructor() VRFConsumerBaseV2Plus(COORDINATOR) { }

    function climb(
        bytes32 keyHash,
        uint256 subscriptionId,
        uint16 requestConfirmations,
        uint32 callbackGasLimit,
        uint32 numWords,
        bool payWithETH
    ) external {
        s_vrfCoordinator.requestRandomWords(
            VRFV2PlusClient.RandomWordsRequest({
                keyHash: keyHash,
                subId: subscriptionId,
                requestConfirmations: requestConfirmations,
                callbackGasLimit: callbackGasLimit,
                numWords: numWords,
                extraArgs: VRFV2PlusClient._argsToBytes(
                    VRFV2PlusClient.ExtraArgsV1({ nativePayment: payWithETH })
                )
            })
        );
    }



    function fulfillRandomWords(
        uint256, /* requestId */
        uint256[] calldata randomWords
    ) internal override {
        floorsClimbed = uint32(randomWords.length);
        delete randomResults;                        // ✅ 기존 결과 제거
        for (uint256 i = 0; i < randomWords.length; i++) {
            randomResults.push(randomWords[i]);      // ✅ 새 결과 저장
        }
    }

}