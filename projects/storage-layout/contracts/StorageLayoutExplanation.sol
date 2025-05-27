// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract StorageLayoutExplanation {
    // Slot 1: Static value types (packed into one slot)
    bool    public aBool;   // 1 byte
    uint8   public aUint8;  // 1 byte
    uint32  public aUint32; // 4 bytes

    // Slot 2: Full-slot types
    uint256 public aUint256; // 32 bytes
    bytes32 public aBytes32; // 32 bytes

    // Slot 3, 4: Dynamic types ≤31 bytes (in-place)
    bytes   public aBytes;  // data + flag(length * 2 + 1)
    string  public aString; // data + flag(length * 2 + 1)

    // Slot 5, 6: Dynamic types >31 bytes (out-of-place)
    bytes   public aBytesLong;  // flag(length * 2) && data at keccak256(5)+i
    string  public aStringLong; // flag(length * 2) && data at keccak256(5)+i

    // Slot 7: Dynamic array
    uint256[] public aUintArray; // length; data at keccak256(7)+i

    // Slot 8: Mappings (1 dimension)
    mapping(uint256 => uint256) public aMapping;
    // Slot 9: Mappings (2 dimension)
    mapping(uint256 => mapping(uint256 => uint256)) public aDoubleMap;

    /// @notice Constructor
    /// @dev Initialize variables (to ensure that variables at that location are properly contained when reading slot-wise values)
    ///
    /// slot 단위 값 읽을 때 해당 위치의 변수들이 정상적으로 들어있는지 확인을 위해 변수 초기화 수행 
    constructor() {
        // initialize static
        aBool    = true;
        aUint8   = 0xAB;
        aUint32  = 0xDEAD;
        aUint256 = 123456;
        aBytes32 = keccak256(bytes("hello"));

        // ≤31-byte dynamic
        aBytes  = hex"cafebabe"; // 4 bytes
        aString = "remix"; // 5 bytes

        // >31-byte dynamic
        aBytesLong  = bytes("0123456789abcdef0123456789abcdef0123456789abcdef0123"); // 52 bytes
        aStringLong = "This is a deliberately long string stored out of place in storage"; // 65 bytes

        // array & mappings
        aUintArray.push(999);
        aMapping[1] = 1001;
        aDoubleMap[2][3] = 2002;
    }

    /// @notice Reads the value contained in Slot.
    /// @param slot Slot Index (uint256)
    /// @return value The value contained in the slot (32 bytes)
    ///
    /// slot index(slot)에 들어있는 데이터 반환 (32bytes)
    function readSlot(uint256 slot) external view returns (bytes32 value) {
        assembly {
            value := sload(slot)
        }
    }

    /// @notice Find the slot index where the beginning of the bytesLong data (>= 32 bytes) is stored.
    /// @return _ the slot index where the beginning of the bytesLong data (>= 32 bytes) is stored
    /// @dev The hash value resulting from the keccak256 operation on the declared variable slot index becomes slot index
    ///
    /// keccak256(abi.encode(uint256("슬롯번호")));
    function getSlotIndexBytesLongData() external pure returns (bytes32) {
        return keccak256(abi.encode(uint256(5)));
    }

    /// @notice Find the slot index where the beginning of the stringLong data (>= 32 bytes) is stored.
    /// @return _ the slot index where the beginning of the stringLong data (>= 32 bytes) is stored
    /// @dev The hash value resulting from the keccak256 operation on the declared variable slot index becomes slot index
    ///
    /// keccak256(abi.encode(uint256("슬롯번호")));
    function getSlotIndexStringLongData() external pure returns (bytes32) {
        return keccak256(abi.encode(uint256(6)));
    }

    /// @notice Find the slot index where the value of the element corresponding to “arrayIndex” in the array is stored.
    /// @return _ the slot index where the value of the element corresponding to “arrayIndex” in the array is stored
    /// @dev The hash value of the keccak256 operation applied to the slot index of the declared array variable becomes the slot index 
    /// where the 0th element of the array is stored, and the slot index is incremented sequentially as the index of the array increases.
    ///
    /// bytes32(uint256(keccak256(abi.encode(uint256("슬롯번호")))) + arrayIndex)
    function getSlotIndexArrayData(uint256 arrayIndex) external pure returns (bytes32) {
        return bytes32(uint256(keccak256(abi.encode(uint256(7)))) + arrayIndex);
    }

    /// @notice Find the slot index where the data corresponding to “key” in the mapping variable is stored.
    /// @return _ the slot index where the data corresponding to “key” is stored
    /// @dev The hash value obtained by performing the keccak256 operation on the result obtained by passing the “key” and “slot index” as arguments 
    /// using the abi.encode function is the slot index where the data is stored.
    ///
    /// keccak256(abi.encode(key, uint256("슬롯번호")))
    /// "key"와 "슬롯번호"를 abi.encode한 값을 keccak256한 hash값 -> "key"에 대응되는 데이터가 저장된 슬롯 인덱스
    function getSlotIndexMappingData(uint256 key) external pure returns (bytes32) {
        return keccak256(abi.encode(key, uint256(8)));
    }

    /// @notice Find the slot index where the data corresponding to ‘key1’ and ‘key2’ of the double mapping variable is stored.
    /// @return _ the slot index where the data corresponding to ‘key1’ and ‘key2’ of the double mapping variable is stored
    /// @dev The hash value obtained by performing the keccak256 operation on the result obtained by passing “key1” and “slot index” as arguments 
    /// to the abi.encode function becomes the new “slot index.”
    /// Using the abi.encode function, pass “key2” and the “slot index” obtained above as arguments, perform the keccak256 operation on the result, 
    /// and the hash value obtained is the slot index where the data corresponding to the ‘key1’ and “key2” of the double mapping variable is stored.

    ///
    /// keccak256(abi.encode(key, uint256("슬롯번호")))
    /// "key1"와 "슬롯번호"를 abi.encode한 값을 keccak256한 hash값 -> 새로운 슬롯번호
    /// "key2"와 위에서 구한 새로운 슬롯번호를 abi.encode한 값을 keccak256한 hash값 -> "key1"과 "key2"에 대응되는 데이터가 저장된 슬롯 인덱스
    function getSlotIndexDoubleMappingData(
        uint256 key1, 
        uint256 key2
    ) external pure returns (bytes32) {
        bytes32 outer = keccak256(abi.encode(key1, uint256(9)));
        return keccak256(abi.encode(key2, outer));
    }
}
