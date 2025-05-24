// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/MyPermitToken.sol";

contract MyPermitTokenTest is Test {
    MyPermitToken token;

    address owner;
    uint256 ownerPk;

    address spender;
    uint256 spenderPk;

    address others;
    uint256 othersPk;

    uint256 constant VALUE = 10 ether;

    function setUp() public {
        (owner, ownerPk) = makeAddrAndKey("OWNER");
        (spender, spenderPk) = makeAddrAndKey("SPENDER");
        (others, othersPk) = makeAddrAndKey("OTHERS");

        vm.prank(owner);
        token = new MyPermitToken();
    }

    function test_validPermitSignature_shouldMatchDigestAndSigner() public view {
        uint256 deadline = block.timestamp + 1 hours;

        (bytes32 structHash, bytes32 digest) = token.debugPermit_getAllHashes(
            owner,
            spender,
            VALUE,
            deadline
        );

        bytes32 domainSeparator = token.DOMAIN_SEPARATOR();

        bytes32 typedDigest = keccak256(abi.encodePacked(
            "\x19\x01",
            domainSeparator,
            structHash
        ));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerPk, typedDigest);

        assertEq(digest, typedDigest, "Digest mismatch between off-chain and on-chain");

        address recovered = token.debugPermit_getSigner(
            owner,
            spender,
            VALUE,
            deadline,
            v, r, s
        );
        assertEq(recovered, owner, "Recovered signer mismatch");
    }

    function test_permit_shouldRevertIfSignerIsSpender() public {
        uint256 deadline = block.timestamp + 1 hours;

        (bytes32 structHash, ) = token.debugPermit_getAllHashes(
            owner,
            spender,
            VALUE,
            deadline
        );

        bytes32 domainSeparator = token.DOMAIN_SEPARATOR();

        bytes32 typedDigest = keccak256(abi.encodePacked(
            "\x19\x01",
            domainSeparator,
            structHash
        ));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(spenderPk, typedDigest);

        // 예상되는 전체 revert 데이터 (selector + 인자 2개)
        bytes memory revertData = abi.encodeWithSelector(
            0x4b800e46,
            spender,
            owner
        );

        vm.expectRevert(revertData);
        
        token.permit(owner, spender, VALUE, deadline, v, r, s);
    }

    function test_permit_shouldRevertIfSignerIsOthers() public {
        uint256 deadline = block.timestamp + 1 hours;

        (bytes32 structHash, ) = token.debugPermit_getAllHashes(
            owner,
            spender,
            VALUE,
            deadline
        );

        bytes32 domainSeparator = token.DOMAIN_SEPARATOR();

        bytes32 typedDigest = keccak256(abi.encodePacked(
            "\x19\x01",
            domainSeparator,
            structHash
        ));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(othersPk, typedDigest);

        // 예상되는 전체 revert 데이터 (selector + 인자 2개)
        bytes memory revertData = abi.encodeWithSelector(
            0x4b800e46,
            others,
            owner
        );

        vm.expectRevert(revertData);

        token.permit(owner, spender, VALUE, deadline, v, r, s);
    }
}
