const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("StorageLayoutExplanationTest", function () {
    let storageLayout;

    before(async function () {
        const Factory = await ethers.getContractFactory("StorageLayoutExplanation");
        storageLayout = await Factory.deploy();
        await storageLayout.waitForDeployment();
    });

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

    it("3) Short dynamic types (≤31B) are in-place: bytes & string", async function () {
        // aBytes (4 bytes)
        const slot3Raw = BigInt(await storageLayout.readSlot(3));
        // in-place 확인
        expect(slot3Raw & 1n).to.equal(0n);
        // 길이는 “하위 1바이트”에서만 꺼내고 나누기 2
        const lenBytes = Number((slot3Raw & 0xffn) / 2n);
        expect(lenBytes).to.equal(4);

        // aString ("remix" = 5 bytes)
        const slot4Raw = BigInt(await storageLayout.readSlot(4));
        expect(slot4Raw & 1n).to.equal(0n);
        const lenString = Number((slot4Raw & 0xffn) / 2n);
        expect(lenString).to.equal(5);
    });

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

    it("5) Dynamic array stores length in slot and data out-of-place", async function () {
        // length == 1
        const slot7Len = BigInt(await storageLayout.readSlot(7));
        expect(slot7Len).to.equal(1n);

        // element[0] at keccak256(7) + 0
        const dataSlot7 = await storageLayout.getSlotIndexArrayData(0);
        const elem0Raw  = await storageLayout.readSlot(dataSlot7);
        expect(BigInt(elem0Raw)).to.equal(999n);
    });

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
