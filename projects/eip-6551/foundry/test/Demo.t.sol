// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/MyNFT.sol";
import "../../contracts/ERC6551Account.sol";
import "../../contracts/ERC6551Registry.sol";

contract DemoTest is Test {
    address alice = address(0xA11CE);
    address bob   = address(0xB0B);

    MyNFT nft;
    ERC6551Account impl;
    ERC6551Registry reg;

    function setUp() public {
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);

        vm.startPrank(alice);
        nft = new MyNFT();
        impl = new ERC6551Account();
        reg  = new ERC6551Registry();
        vm.stopPrank();
    }

    function test_flow() public {
        vm.startPrank(alice);

        // 1) 민트
        uint256 id = nft.mint(alice);

        // 2) 주소 예측/생성 동일성
        bytes32 salt = keccak256("DEMO_SALT_V1");
        address predicted = reg.account(address(impl), salt, block.chainid, address(nft), id);
        address tba = reg.createAccount(address(impl), salt, block.chainid, address(nft), id);
        assertEq(tba, predicted, "predicted != created");

        // 3) 자금 송금 + 실행
        (bool ok,) = tba.call{value: 1 ether}("");
        assertTrue(ok, "fund failed");

        Target target = new Target();
        bytes memory data = abi.encodeWithSignature("ping(bytes)", bytes("hi"));
        ERC6551Account(payable(tba)).execute(address(target), 0.1 ether, data, 0);

        // 4) 소유자 변경 후 권한 변경 확인
        nft.transferFrom(alice, bob, id);

        // 지금은 alice가 owner가 아님 → revert
        vm.expectRevert();
        ERC6551Account(payable(tba)).execute(address(target), 0, data, 0);

        vm.stopPrank();

        // bob은 실행 가능
        vm.prank(bob);
        ERC6551Account(payable(tba)).execute(address(target), 0, data, 0);
    }
}

contract Target {
    event Ping(address from, uint256 val, bytes data);
    function ping(bytes calldata data) external payable {
        emit Ping(msg.sender, msg.value, data);
    }
}
