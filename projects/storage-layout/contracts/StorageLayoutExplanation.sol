// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title StorageLayoutExplanation contract
 * @notice Solidity 스토리지 레이아웃을 설명하는 교육용 컨트랙트
 * @dev 다양한 데이터 타입들이 스토리지 슬롯에 어떻게 저장되는지 시연
 *      - 정적 타입 (bool, uint8, uint32, uint256, bytes32)
 *      - 동적 타입 (bytes, string) - 31바이트 이하/초과 구분
 *      - 배열과 매핑의 스토리지 위치 계산
 * @author hlibbc
 */
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

    /**
     * @notice StorageLayoutExplanation 컨트랙트 생성자
     * @dev 각 스토리지 슬롯에 다양한 타입의 데이터를 초기화
     *      - 정적 타입들: bool, uint8, uint32, uint256, bytes32
     *      - 동적 타입들: bytes, string (31바이트 이하/초과)
     *      - 배열과 매핑 데이터 초기화
     *      - slot 단위 값 읽을 때 해당 위치의 변수들이 정상적으로 들어있는지 확인을 위해 변수 초기화 수행
     */
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

    /**
     * @notice 지정된 슬롯에 저장된 값을 읽어온다
     * @param slot 읽을 슬롯 인덱스 (uint256)
     * @return value 슬롯에 저장된 값 (32 bytes)
     * @dev assembly를 사용하여 직접 스토리지에서 값을 읽어옴
     *      slot index(slot)에 들어있는 데이터 반환 (32bytes)
     */
    function readSlot(uint256 slot) external view returns (bytes32 value) {
        assembly {
            value := sload(slot)
        }
    }

    /**
     * @notice bytesLong 데이터(>= 32 bytes)가 저장된 시작 슬롯 인덱스를 찾는다
     * @return _ bytesLong 데이터가 저장된 시작 슬롯 인덱스
     * @dev 선언된 변수의 슬롯 인덱스에 대한 keccak256 연산 결과가 슬롯 인덱스가 됨
     *      keccak256(abi.encode(uint256("슬롯번호")));
     */
    function getSlotIndexBytesLongData() external pure returns (bytes32) {
        return keccak256(abi.encode(uint256(5)));
    }

    /**
     * @notice stringLong 데이터(>= 32 bytes)가 저장된 시작 슬롯 인덱스를 찾는다
     * @return _ stringLong 데이터가 저장된 시작 슬롯 인덱스
     * @dev 선언된 변수의 슬롯 인덱스에 대한 keccak256 연산 결과가 슬롯 인덱스가 됨
     *      keccak256(abi.encode(uint256("슬롯번호")));
     */
    function getSlotIndexStringLongData() external pure returns (bytes32) {
        return keccak256(abi.encode(uint256(6)));
    }

    /**
     * @notice 배열에서 "arrayIndex"에 해당하는 요소의 값이 저장된 슬롯 인덱스를 찾는다
     * @param arrayIndex 배열의 인덱스
     * @return _ 배열 요소가 저장된 슬롯 인덱스
     * @dev 선언된 배열 변수의 슬롯 인덱스에 적용된 keccak256 연산의 해시값이 배열의 0번째 요소가 저장된 슬롯 인덱스가 되고,
     *      배열의 인덱스가 증가함에 따라 슬롯 인덱스가 순차적으로 증가함
     *      bytes32(uint256(keccak256(abi.encode(uint256("슬롯번호")))) + arrayIndex)
     */
    function getSlotIndexArrayData(uint256 arrayIndex) external pure returns (bytes32) {
        return bytes32(uint256(keccak256(abi.encode(uint256(7)))) + arrayIndex);
    }

    /**
     * @notice 매핑 변수에서 "key"에 해당하는 데이터가 저장된 슬롯 인덱스를 찾는다
     * @param key 매핑의 키 값
     * @return _ "key"에 해당하는 데이터가 저장된 슬롯 인덱스
     * @dev "key"와 "슬롯 인덱스"를 abi.encode 함수의 인수로 전달하여 얻은 결과에 
     *      keccak256 연산을 수행한 해시값이 데이터가 저장된 슬롯 인덱스가 됨
     *      keccak256(abi.encode(key, uint256("슬롯번호")))
     *      "key"와 "슬롯번호"를 abi.encode한 값을 keccak256한 hash값 -> "key"에 대응되는 데이터가 저장된 슬롯 인덱스
     */
    function getSlotIndexMappingData(uint256 key) external pure returns (bytes32) {
        return keccak256(abi.encode(key, uint256(8)));
    }

    /**
     * @notice 이중 매핑 변수에서 'key1'과 'key2'에 해당하는 데이터가 저장된 슬롯 인덱스를 찾는다
     * @param key1 첫 번째 매핑의 키 값
     * @param key2 두 번째 매핑의 키 값
     * @return _ 이중 매핑 변수에서 'key1'과 'key2'에 해당하는 데이터가 저장된 슬롯 인덱스
     * @dev "key1"과 "슬롯 인덱스"를 abi.encode 함수의 인수로 전달하여 얻은 결과에 keccak256 연산을 수행한 해시값이 
     *      새로운 "슬롯 인덱스"가 됨. abi.encode 함수를 사용하여 "key2"와 위에서 구한 "슬롯 인덱스"를 인수로 전달하고,
     *      결과에 keccak256 연산을 수행한 해시값이 이중 매핑 변수의 'key1'과 "key2"에 해당하는 데이터가 저장된 슬롯 인덱스가 됨
     *      keccak256(abi.encode(key, uint256("슬롯번호")))
     *      "key1"와 "슬롯번호"를 abi.encode한 값을 keccak256한 hash값 -> 새로운 슬롯번호
     *      "key2"와 위에서 구한 새로운 슬롯번호를 abi.encode한 값을 keccak256한 hash값 -> "key1"과 "key2"에 대응되는 데이터가 저장된 슬롯 인덱스
     */
    function getSlotIndexDoubleMappingData(
        uint256 key1, 
        uint256 key2
    ) external pure returns (bytes32) {
        bytes32 outer = keccak256(abi.encode(key1, uint256(9)));
        return keccak256(abi.encode(key2, outer));
    }
}
