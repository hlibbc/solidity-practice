// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {DebugNestedPermit} from "../../contracts/mocks/DebugNestedPermit.sol";

contract DebugNestedPermitTest is Test, DebugNestedPermit {
    DebugNestedPermit permit;

    address signer;
    uint256 signerPk;
    address other;
    uint256 otherPk;

    function setUp() public {
        (signer, signerPk) = makeAddrAndKey("SIGNER");
        (other, otherPk) = makeAddrAndKey("OTHER");

        vm.prank(signer);
        permit = new DebugNestedPermit();
    }

    function _buildOrder(
        address fromWallet, 
        string memory fromName
    ) internal pure returns (Order memory)
    {
        Person memory from = Person({
            wallet: fromWallet,
            name: fromName
        });

        Person memory to = Person({
            wallet: address(0xdead),
            name: "Bob"
        });

        return Order({
            from: from,
            to: to,
            amount: 1 ether,
            nonce: 1
        });
    }


    function test_verify_structHash_and_digest_match_offchain() public view {
        Order memory order = _buildOrder(signer, "Alice");

        bytes32 structHash = permit.getStructHash(order);
        bytes32 digest = permit.getDigest(order);
        bytes32 domainSeparator = permit.getDomainSeparator();

        console.log("structHash:");
        console.logBytes32(structHash);

        console.log("digest:");
        console.logBytes32(digest);

        console.log("domainSeparator:");
        console.logBytes32(domainSeparator);

        // 최소 유효성 검증
        assertEq(bytes32(structHash).length, 32);
        assertEq(bytes32(digest).length, 32);
    }

    function test_verify_valid_signature() public view {
        Order memory order = _buildOrder(signer, "Alice");

        bytes32 digest = permit.getDigest(order);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        bool valid = permit.verify(order, signature);
        assertTrue(valid);

        address recovered = permit.recoverSigner(order, signature);
        assertEq(recovered, signer);
    }

    function test_verify_fail_wrong_signer() public view {
        Order memory order = _buildOrder(signer, "Alice");

        bytes32 digest = permit.getDigest(order);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(otherPk, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        bool valid = permit.verify(order, signature);
        assertFalse(valid);

        address recovered = permit.recoverSigner(order, signature);
        assertTrue(recovered != signer);
    }

    function test_verify_fail_if_order_tampered() public view {
        Order memory originalOrder = _buildOrder(signer, "Alice");
        bytes32 digest = permit.getDigest(originalOrder);

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        Order memory tampered = _buildOrder(signer, "Evil Alice");
        bool valid = permit.verify(tampered, signature);
        assertFalse(valid);
    }
}
