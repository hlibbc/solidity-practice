// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/StorageLayoutExplanation.sol";

contract StorageLayoutExplanationTest is Test {
    StorageLayoutExplanation sut;

    function setUp() public {
        sut = new StorageLayoutExplanation();
    }

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

    function test_ShortDynamic_InPlaceEven() public view {
        // aBytes (4바이트) → in-place, slotVal mod2 == 0
        bytes32 slot3 = vm.load(address(sut), bytes32(uint256(3)));
        assertEq(uint256(slot3) % 2, 0, "aBytes in-place flag");

        // aString ("remix", 5바이트) → in-place, slotVal mod2 == 0
        bytes32 slot4 = vm.load(address(sut), bytes32(uint256(4)));
        assertEq(uint256(slot4) % 2, 0, "aString in-place flag");
    }

    function test_LongDynamic_OutOfPlaceOdd() public view {
        // aBytesLong (>31바이트) → out-of-place, slotVal mod2 == 1
        bytes32 slot5 = vm.load(address(sut), bytes32(uint256(5)));
        assertEq(uint256(slot5) % 2, 1, "aBytesLong out-of-place flag");

        // aStringLong (>31바이트) → out-of-place, slotVal mod2 == 1
        bytes32 slot6 = vm.load(address(sut), bytes32(uint256(6)));
        assertEq(uint256(slot6) % 2, 1, "aStringLong out-of-place flag");
    }

    function test_DynamicArray() public view {
        // length in slot7
        bytes32 slot7 = vm.load(address(sut), bytes32(uint256(7)));
        assertEq(uint256(slot7), 1, "aUintArray.length");

        // element[0] at keccak256(7) + 0
        bytes32 dataSlot7 = keccak256(abi.encode(uint256(7)));
        bytes32 elem0 = vm.load(address(sut), dataSlot7);
        assertEq(uint256(elem0), 999, "aUintArray[0]");
    }

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
