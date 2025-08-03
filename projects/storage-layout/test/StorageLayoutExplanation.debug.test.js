/**
 * @file StorageLayoutExplanation.debug.test.js
 * @notice StorageLayoutExplanation 컨트랙트의 스토리지 레이아웃을 디버깅하는 테스트 스크립트
 * @author hlibbc
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * @notice StorageLayoutExplanation 컨트랙트의 스토리지 레이아웃을 테스트한다.
 * @dev chai assertion 라이브러리와 ethers v6 사용
 *      - 정적 타입들의 패킹 검증
 *      - 동적 타입들의 in-place/out-of-place 저장 검증
 *      - 배열과 매핑의 스토리지 위치 계산 검증
 */
describe("StorageLayoutExplanationTest", function () {
    let storageLayout;

    /**
     * @notice 테스트 시작 전에 실행되는 설정 함수
     * @dev StorageLayoutExplanation 컨트랙트를 배포하고 초기화
     */
    before(async function () {
        const Factory = await ethers.getContractFactory("StorageLayoutExplanation");
        storageLayout = await Factory.deploy();
        await storageLayout.waitForDeployment();
    });

    /**
     * @notice 정적 타입들이 올바르게 저장되고 슬롯 0에 패킹되는지 테스트
     * @dev bool, uint8, uint32가 하나의 슬롯에 압축되어 저장되는지 확인
     *      - aBool: bit 0에 저장
     *      - aUint8: byte 1에 저장 (8비트 우측 시프트)
     *      - aUint32: bytes 2-5에 저장 (16비트 우측 시프트)
     */
    it("1) Static value types are correct via getters and packed in slot 0", async function () {
        // public getters
        expect(await storageLayout.aBool()).to.equal(true);
        expect(await storageLayout.aUint8()).to.equal(0xAB);
        expect(await storageLayout.aUint32()).to.equal(0xDEAD);

        // slot 0 raw word 읽기
        const slot0Raw = await storageLayout.readSlot(0);
        const slot0    = BigInt(slot0Raw);

        // aBool @ bit 0
        expect(slot0 & 1n).to.equal(1n);

        // aUint8 @ byte 1: shift right 8 bits, mask 0xff
        const byte1 = Number((slot0 >> 8n) & 0xffn);
        expect(byte1).to.equal(0xAB);

        // aUint32 @ bytes 2–5: shift right 16 bits, mask 0xffffffff
        const word32 = Number((slot0 >> 16n) & 0xffffffffn);
        expect(word32).to.equal(0xDEAD);
    });

    /**
     * @notice 전체 슬롯을 차지하는 타입들이 각각 별도 슬롯에 저장되는지 테스트
     * @dev uint256과 bytes32가 각각 독립적인 슬롯에 저장되는지 확인
     *      - aUint256: 슬롯 1에 저장
     *      - aBytes32: 슬롯 2에 저장
     */
    it("2) Full-slot types occupy their own slots", async function () {
        // aUint256
        expect(await storageLayout.aUint256()).to.equal(123456n);
        const slot1 = BigInt(await storageLayout.readSlot(1));
        expect(slot1).to.equal(123456n);

        // aBytes32
        const bs32  = await storageLayout.aBytes32();
        const slot2 = await storageLayout.readSlot(2);
        expect(slot2).to.equal(bs32);
    });

    /**
     * @notice 31바이트 이하 동적 타입들이 in-place로 저장되는지 테스트
     * @dev 짧은 bytes와 string이 슬롯 내에 직접 저장되는지 확인
     *      - in-place 저장 시 하위 1비트가 0 (짝수)
     *      - 길이는 하위 1바이트에서 추출하고 2로 나눔
     *      - aBytes: 4바이트, 슬롯 3에 저장
     *      - aString: 5바이트, 슬롯 4에 저장
     */
    it("3) Short dynamic types (≤31B) are in-place: bytes & string", async function () {
        // aBytes (4 bytes)
        const slot3Raw = BigInt(await storageLayout.readSlot(3));
        // in-place 확인
        expect(slot3Raw & 1n).to.equal(0n);
        // 길이는 "하위 1바이트"에서만 꺼내고 나누기 2
        const lenBytes = Number((slot3Raw & 0xffn) / 2n);
        expect(lenBytes).to.equal(4);

        // aString ("remix" = 5 bytes)
        const slot4Raw = BigInt(await storageLayout.readSlot(4));
        expect(slot4Raw & 1n).to.equal(0n);
        const lenString = Number((slot4Raw & 0xffn) / 2n);
        expect(lenString).to.equal(5);
    });

    /**
     * @notice 31바이트 초과 동적 타입들이 out-of-place로 저장되는지 테스트
     * @dev 긴 bytes와 string이 별도 위치에 저장되는지 확인
     *      - out-of-place 저장 시 하위 1비트가 1 (홀수)
     *      - 길이는 (슬롯값 - 1) / 2로 계산
     *      - aBytesLong: 52바이트, 슬롯 5에 플래그 저장
     *      - aStringLong: 65바이트, 슬롯 6에 플래그 저장
     */
    it("4) Long dynamic types (>31B) are out-of-place", async function () {
        // aBytesLong
        const slot5 = BigInt(await storageLayout.readSlot(5));
        // out-of-place 모드: slot5 = length * 2 + 1 (홀수)
        expect(slot5 & 1n).to.equal(1n);
        const lenBytesLong = Number((slot5 - 1n) / 2n);
        expect(lenBytesLong).to.be.greaterThan(31);

        // aStringLong
        const slot6 = BigInt(await storageLayout.readSlot(6));
        expect(slot6 & 1n).to.equal(1n);
        const lenStringLong = Number((slot6 - 1n) / 2n);
        expect(lenStringLong).to.be.greaterThan(31);
    });

    /**
     * @notice 동적 배열의 스토리지 레이아웃을 테스트
     * @dev 배열의 길이와 요소들이 올바른 위치에 저장되는지 확인
     *      - 배열 길이: 슬롯 7에 저장
     *      - 배열 요소: keccak256(7) + index 위치에 저장
     *      - aUintArray[0] = 999
     */
    it("5) Dynamic array stores length in slot and data out-of-place", async function () {
        // length == 1
        const slot7Len = BigInt(await storageLayout.readSlot(7));
        expect(slot7Len).to.equal(1n);

        // element[0] at keccak256(7) + 0
        const dataSlot7 = await storageLayout.getSlotIndexArrayData(0);
        const elem0Raw  = await storageLayout.readSlot(dataSlot7);
        expect(BigInt(elem0Raw)).to.equal(999n);
    });

    /**
     * @notice 매핑과 이중 매핑의 스토리지 레이아웃을 테스트
     * @dev 단일 매핑과 이중 매핑의 키-값 쌍이 올바른 위치에 저장되는지 확인
     *      - aMapping[1] = 1001
     *      - aDoubleMap[2][3] = 2002
     *      - 매핑 데이터는 keccak256(key, slot) 위치에 저장
     */
    it("6) Mapping and double mapping", async function () {
        // single mapping: aMapping[1] == 1001
        const mapSlotRaw = await storageLayout.getSlotIndexMappingData(1);
        const mapValRaw  = await storageLayout.readSlot(mapSlotRaw);
        expect(BigInt(mapValRaw)).to.equal(1001n);

        // double mapping: aDoubleMap[2][3] == 2002
        const dmSlotRaw = await storageLayout.getSlotIndexDoubleMappingData(2, 3);
        const dmValRaw  = await storageLayout.readSlot(dmSlotRaw);
        expect(BigInt(dmValRaw)).to.equal(2002n);
    });
});
