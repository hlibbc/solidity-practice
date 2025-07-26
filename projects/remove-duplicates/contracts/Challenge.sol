// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract Challenge {

    /**
     * @dev Remove duplicates from an array of uint8
     * @param input An array of uint8
     * @return output An array of uint8 without duplicates
     */
    function dispelDuplicates(
        uint8[] calldata input
    ) public pure returns (uint8[] memory output) {
        bool[256] memory seen;
        uint count = 0;

        // 최초 순회를 통해 중복을 제거하고, 바로 결과 배열을 구성합니다.
        output = new uint8[](input.length); // 최대 길이로 배열을 선언합니다. 후에 조정 가능
        for (uint i = 0; i < input.length; ++i) {
            if (!seen[input[i]]) {
                seen[input[i]] = true;
                output[count++] = input[i]; // 중복되지 않은 요소만 결과 배열에 추가
            }
        }

        // 필요한 경우 배열 크기 조정
        // 이 코드를 실행하면, output 배열의 메모리 상의 "길이" 값이 count로 변경됨
        if (count < input.length) {
            assembly {
                mstore(output, count) // 배열의 크기를 실제 중복 없는 요소 수로 조정
            }
        }
    }
    
}