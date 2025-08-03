// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/StorageLayoutExplanation.sol";

/**
 * @title StorageLayoutExplanationTest contract
 * @notice StorageLayoutExplanation 컨트랙트의 스토리지 레이아웃을 테스트하는 Foundry 테스트
 * @dev 다양한 데이터 타입들이 스토리지 슬롯에 올바르게 저장되는지 검증
 *      - 정적 타입들의 패킹 (bool, uint8, uint32)
 *      - 전체 슬롯 타입들 (uint256, bytes32)
 *      - 동적 타입들의 in-place/out-of-place 저장
 *      - 배열과 매핑의 스토리지 위치 계산
 * @author hlibbc
 */
contract StorageLayoutExplanationTest is Test {
    StorageLayoutExplanation sut;

    /**
     * @notice 각 테스트 전에 실행되는 설정 함수
     * @dev 새로운 StorageLayoutExplanation 인스턴스를 생성
     */
    function setUp() public {
        sut = new StorageLayoutExplanation();
    }

    /**
     * @notice 정적 타입들이 슬롯 0에 패킹되어 저장되는지 테스트
     * @dev bool, uint8, uint32가 하나의 슬롯에 압축되어 저장되는지 확인
     *      - aBool: bit0 = 1
     *      - aUint8: 다음 바이트 (0xAB)
     *      - aUint32: 그 다음 4바이트 (0xDEAD)
     */
    function test_StaticTypesPackedInSlot0() public view {
        // public getter 로도 값 확인
        assertEq(sut.aBool(), true, "aBool getter");
        assertEq(sut.aUint8(), uint8(0xAB), "aUint8 getter");
        assertEq(sut.aUint32(), uint32(0xDEAD), "aUint32 getter");

        // slot0 raw word 읽기
        uint256 slot0Index = 0;
        bytes32 slot0 = vm.load(address(sut), bytes32(slot0Index));

        // aBool: bit0 = 1
        assertEq(uint8(uint256(slot0) & 0x1), 1, "aBool in slot0");

        // aUint8: 다음 바이트
        assertEq(uint8(uint256(slot0) >> 8), 0xAB, "aUint8 in slot0");

        // aUint32: 그 다음 4바이트
        assertEq(uint32(uint256(slot0) >> 16), 0xDEAD, "aUint32 in slot0");
    }

    /**
     * @notice 전체 슬롯을 차지하는 타입들의 저장을 테스트
     * @dev uint256과 bytes32가 각각 별도의 슬롯에 저장되는지 확인
     *      - uint256: 슬롯 1에 저장
     *      - bytes32: 슬롯 2에 저장
     */
    function test_FullSlotTypes() public view {
        // uint256 in slot1
        assertEq(sut.aUint256(), 123456);
        bytes32 slot1 = vm.load(address(sut), bytes32(uint256(1)));
        assertEq(uint256(slot1), 123456);

        // bytes32 in slot2
        bytes32 rawB32 = sut.aBytes32();
        bytes32 slot2 = vm.load(address(sut), bytes32(uint256(2)));
        assertEq(slot2, rawB32);
    }

    /**
     * @notice 31바이트 이하 동적 타입들의 in-place 저장을 테스트
     * @dev 짧은 bytes와 string이 슬롯 내에 직접 저장되는지 확인
     *      - in-place 저장 시 slotVal mod2 == 0 (짝수)
     *      - aBytes: 4바이트, 슬롯 3에 저장
     *      - aString: 5바이트, 슬롯 4에 저장
     */
    function test_ShortDynamic_InPlaceEven() public view {
        // aBytes (4바이트) → in-place, slotVal mod2 == 0
        bytes32 slot3 = vm.load(address(sut), bytes32(uint256(3)));
        assertEq(uint256(slot3) % 2, 0, "aBytes in-place flag");

        // aString ("remix", 5바이트) → in-place, slotVal mod2 == 0
        bytes32 slot4 = vm.load(address(sut), bytes32(uint256(4)));
        assertEq(uint256(slot4) % 2, 0, "aString in-place flag");
    }

    /**
     * @notice 31바이트 초과 동적 타입들의 out-of-place 저장을 테스트
     * @dev 긴 bytes와 string이 별도 위치에 저장되는지 확인
     *      - out-of-place 저장 시 slotVal mod2 == 1 (홀수)
     *      - aBytesLong: 52바이트, 슬롯 5에 플래그 저장
     *      - aStringLong: 65바이트, 슬롯 6에 플래그 저장
     */
    function test_LongDynamic_OutOfPlaceOdd() public view {
        // aBytesLong (>31바이트) → out-of-place, slotVal mod2 == 1
        bytes32 slot5 = vm.load(address(sut), bytes32(uint256(5)));
        assertEq(uint256(slot5) % 2, 1, "aBytesLong out-of-place flag");

        // aStringLong (>31바이트) → out-of-place, slotVal mod2 == 1
        bytes32 slot6 = vm.load(address(sut), bytes32(uint256(6)));
        assertEq(uint256(slot6) % 2, 1, "aStringLong out-of-place flag");
    }

    /**
     * @notice 동적 배열의 스토리지 레이아웃을 테스트
     * @dev 배열의 길이와 요소들이 올바른 위치에 저장되는지 확인
     *      - 배열 길이: 슬롯 7에 저장
     *      - 배열 요소: keccak256(7) + index 위치에 저장
     *      - aUintArray[0] = 999
     */
    function test_DynamicArray() public view {
        // length in slot7
        bytes32 slot7 = vm.load(address(sut), bytes32(uint256(7)));
        assertEq(uint256(slot7), 1, "aUintArray.length");

        // element[0] at keccak256(7) + 0
        bytes32 dataSlot7 = keccak256(abi.encode(uint256(7)));
        bytes32 elem0 = vm.load(address(sut), dataSlot7);
        assertEq(uint256(elem0), 999, "aUintArray[0]");
    }

    /**
     * @notice 매핑의 스토리지 레이아웃을 테스트
     * @dev 단일 매핑과 이중 매핑의 키-값 쌍이 올바른 위치에 저장되는지 확인
     *      - aMapping[1] = 1001
     *      - aDoubleMap[2][3] = 2002
     *      - 매핑 데이터는 keccak256(key, slot) 위치에 저장
     */
    function test_Mappings() public view {
        // aMapping[1] == 1001
        bytes32 mapSlot = sut.getSlotIndexMappingData(1);
        bytes32 mapVal  = vm.load(address(sut), mapSlot);
        assertEq(uint256(mapVal), 1001, "aMapping[1]");

        // aDoubleMap[2][3] == 2002
        bytes32 dmSlot = sut.getSlotIndexDoubleMappingData(2, 3);
        bytes32 dmVal  = vm.load(address(sut), dmSlot);
        assertEq(uint256(dmVal), 2002, "aDoubleMap[2][3]");
    }
}
