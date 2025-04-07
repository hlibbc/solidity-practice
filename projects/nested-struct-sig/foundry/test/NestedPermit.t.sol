// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/NestedPermit.sol";

contract NestedPermitTest is Test {
    NestedPermit permit;

    address signer;
    uint256 signerPk;

    function setUp() public {
        (signer, signerPk) = makeAddrAndKey("SIGNER");
        vm.prank(signer);
        permit = new NestedPermit();
    }

    function test_verify_nested_signature() public view {
        NestedPermit.Person memory from = NestedPermit.Person({
            wallet: signer,
            name: "Alice"
        });

        NestedPermit.Person memory to = NestedPermit.Person({
            wallet: address(0xdead),
            name: "Bob"
        });

        NestedPermit.Order memory order = NestedPermit.Order({
            from: from,
            to: to,
            amount: 1 ether,
            nonce: 1
        });

        bytes32 structHash = permit.hashOrder(order);
        bytes32 domainSeparator = permit.DOMAIN_SEPARATOR();
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, digest);

        bytes memory signature = abi.encodePacked(r, s, v);
        bool valid = permit.verify(order, signature);
        assertTrue(valid);
    }

    function test_fail_when_wrong_signer() public {
        address fakeSigner;
        uint256 fakeSignerPk;
        (fakeSigner, fakeSignerPk) = makeAddrAndKey("FAKER");

        NestedPermit.Person memory from = NestedPermit.Person({
            wallet: signer,
            name: "Alice"
        });

        NestedPermit.Person memory to = NestedPermit.Person({
            wallet: address(0xdead),
            name: "Bob"
        });

        NestedPermit.Order memory order = NestedPermit.Order({
            from: from,
            to: to,
            amount: 1 ether,
            nonce: 1
        });

        bytes32 structHash = permit.hashOrder(order);
        bytes32 digest = keccak256(abi.encodePacked(
            "\x19\x01",
            permit.DOMAIN_SEPARATOR(),
            structHash
        ));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(fakeSignerPk, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        bool valid = permit.verify(order, sig);
        assertFalse(valid); // ❌ signer != from.wallet 이므로 실패해야 정상
    }

    function test_fail_when_data_modified() public view {
        NestedPermit.Person memory from = NestedPermit.Person({
            wallet: signer,
            name: "Alice"
        });

        NestedPermit.Person memory to = NestedPermit.Person({
            wallet: address(0xdead),
            name: "Bob"
        });

        NestedPermit.Order memory originalOrder = NestedPermit.Order({
            from: from,
            to: to,
            amount: 1 ether,
            nonce: 1
        });

        bytes32 digest = keccak256(abi.encodePacked(
            "\x19\x01",
            permit.DOMAIN_SEPARATOR(),
            permit.hashOrder(originalOrder)
        ));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        // 🧪 order 내용 살짝 조작
        NestedPermit.Order memory tamperedOrder = NestedPermit.Order({
            from: NestedPermit.Person({ wallet: signer, name: "Evil Alice" }),
            to: to,
            amount: 1 ether,
            nonce: 1
        });

        bool valid = permit.verify(tamperedOrder, sig);
        assertFalse(valid); // ✅ 원래 서명과 digest가 달라지므로 실패해야 함
    }
}

