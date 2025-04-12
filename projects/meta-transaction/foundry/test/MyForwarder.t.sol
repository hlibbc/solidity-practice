// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/console.sol";
import {MyForwarder} from "../../contracts/MyForwarder.sol";
import {MetaTxReceiver} from "../../contracts/MetaTxReceiver.sol";
import { ERC2771Forwarder } from "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";


contract MyForwarderTest is Test {
    ERC2771Forwarder public forwarder;
    MetaTxReceiver public receiver;

    address public user;
    uint256 public userKey;
    address public relayer;

    struct ForwardRequest {
        address from;
        address to;
        uint256 value;
        uint256 gas;
        uint256 nonce;
        uint48 deadline;
        bytes data;
    }

    // struct ForwardRequestData {
    //     address from;
    //     address to;
    //     uint256 value;
    //     uint256 gas;
    //     uint48 deadline;
    //     bytes data;
    //     bytes signature;
    // }

    function setUp() public {
        (user, userKey) = makeAddrAndKey("User");
        relayer = makeAddr("Relayer");

        forwarder = new MyForwarder();
        receiver = new MetaTxReceiver(address(forwarder));
    }

    function _buildDomainSeparator() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("MyForwarder")),
                keccak256(bytes("1")),
                block.chainid,
                address(forwarder)
            )
        );
    }


    function _buildRequest(string memory msgText, uint48 deadlineOffset) internal view returns (ForwardRequest memory req) {
        req = ForwardRequest({
            from: user,
            to: address(receiver),
            value: 0,
            gas: 100000,
            nonce: forwarder.nonces(user),
            deadline: uint48(block.timestamp) + deadlineOffset,
            data: abi.encodeWithSignature("setMessage(string)", msgText)
        });
    }

    function _signRequest(ForwardRequest memory req) internal view returns (bytes memory sig) {
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("ForwardRequest(address from,address to,uint256 value,uint256 gas,uint256 nonce,uint48 deadline,bytes data)"),
                req.from,
                req.to,
                req.value,
                req.gas,
                req.nonce,
                req.deadline,
                keccak256(req.data)
            )
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", _buildDomainSeparator(), structHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(userKey, digest);
        sig = abi.encodePacked(r, s, v);
    }

    function _wrapRequest(ForwardRequest memory req, bytes memory sig) internal pure returns (ERC2771Forwarder.ForwardRequestData memory) {
        return ERC2771Forwarder.ForwardRequestData({
            from: req.from,
            to: req.to,
            value: req.value,
            gas: req.gas,
            deadline: req.deadline,
            data: req.data,
            signature: sig
        });
    }

    function testExecuteValid() public {
        ForwardRequest memory req = _buildRequest("Hello", 600);
        bytes memory sig = _signRequest(req);
        ERC2771Forwarder.ForwardRequestData memory wrapped = _wrapRequest(req, sig);

        vm.prank(relayer);
        forwarder.execute(wrapped);

        assertEq(receiver.message(), "Hello");
    }

    function testExecuteInvalidSignature() public {
        ForwardRequest memory req = _buildRequest("Fail", 600);

        // sign with random key
        (, uint256 fakeKey) = makeAddrAndKey("Fake");
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("ForwardRequest(address from,address to,uint256 value,uint256 gas,uint256 nonce,uint48 deadline,bytes data)"),
                req.from,
                req.to,
                req.value,
                req.gas,
                req.nonce,
                req.deadline,
                keccak256(req.data)
            )
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", _buildDomainSeparator(), structHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(fakeKey, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        ERC2771Forwarder.ForwardRequestData memory wrapped = _wrapRequest(req, sig);

        vm.expectRevert();
        vm.prank(relayer);
        forwarder.execute(wrapped);
    }

    function testExecuteExpired() public {
        ForwardRequest memory req = _buildRequest("Expired", 0); // deadline = now
        req.deadline = uint48(block.timestamp); // avoid underflow
        bytes memory sig = _signRequest(req);
        ERC2771Forwarder.ForwardRequestData memory wrapped = _wrapRequest(req, sig);

        vm.warp(block.timestamp + 1); // warp past the deadline

        vm.expectRevert();
        vm.prank(relayer);
        forwarder.execute(wrapped);
    }
}

