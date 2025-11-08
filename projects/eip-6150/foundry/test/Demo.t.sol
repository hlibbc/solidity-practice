// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {MyERC6150} from "../../contracts/MyERC6150.sol";

contract RevisionNFT6150Test is Test {
    MyERC6150 internal rev;
    address internal owner;
    address internal alice;
    address internal bob;

    function setUp() public {
        owner = address(this);
        alice = makeAddr("alice");
        bob   = makeAddr("bob");

        rev = new MyERC6150("Rev6150", "REV");

        // 테스트 편의를 위해 owner를 루트 민터로 등록
        rev.setRootMinter(owner, true);
    }

    function test_MintRootAndChildAndQuery() public {
        uint256 r1 = rev.mintRoot(alice);
        assertEq(r1, 1);
        assertEq(rev.ownerOf(r1), alice);
        assertTrue(rev.isRoot(r1));
        assertTrue(rev.isLeaf(r1)); // 아직 자식 없음

        uint256 c1 = rev.mintChild(alice, r1);
        assertEq(c1, 2);
        assertEq(rev.ownerOf(c1), alice);
        assertEq(rev.parentOf(c1), r1);
        assertTrue(rev.isRoot(r1));
        assertFalse(rev.isLeaf(r1)); // 자식 생겼으니 leaf 아님
        assertTrue(rev.isLeaf(c1));

        uint256[] memory children = rev.childrenOf(r1);
        assertEq(children.length, 1);
        assertEq(children[0], c1);

        assertEq(rev.childrenCountOf(r1), 1);
        assertEq(rev.childOfParentByIndex(r1, 0), c1);
        assertEq(rev.indexInChildrenEnumeration(r1, c1), 0);
    }

    function test_TransferParent() public {
        uint256 r1 = rev.mintRoot(alice); // 1
        uint256 c1 = rev.mintChild(alice, r1); // 2
        uint256 r2 = rev.mintRoot(alice); // 3

        // alice가 호출해야 하므로 프랭크
        vm.startPrank(alice);
        rev.transferParent(r2, c1);
        vm.stopPrank();

        assertEq(rev.parentOf(c1), r2);
        assertEq(rev.childrenCountOf(r1), 0);
        assertEq(rev.childrenCountOf(r2), 1);
        assertEq(rev.childOfParentByIndex(r2, 0), c1);

        // 순환 방지 확인: 자기 하위로 이동 불가
        // r1 밑에 다시 자식 만들고 r1을 c1 밑으로 이동 시도 → revert
        vm.startPrank(alice);
        uint256 c2 = rev.mintChild(alice, r1); // 4
        vm.expectRevert(bytes("Cannot move under descendant"));
        rev.transferParent(c2, r1);
        vm.stopPrank();

        // self-parent 불가
        vm.startPrank(alice);
        vm.expectRevert(bytes("Cannot parent to self"));
        rev.transferParent(r2, r2);
        vm.stopPrank();
    }

    function test_BurnLeaf_RevertWhenNonLeaf() public {
        uint256 r1 = rev.mintRoot(alice); // 1
        uint256 c1 = rev.mintChild(alice, r1); // 2

        // alice가 c1(leaf) 소각 → OK
        vm.prank(alice);
        rev.safeBurn(c1);
        assertEq(rev.childrenCountOf(r1), 0);

        // r1은 leaf 이므로 이제 소각 가능
        vm.prank(alice);
        rev.safeBurn(r1);

        // 없는 토큰 조회시 revert
        vm.expectRevert();
        rev.ownerOf(r1);
    }

    function test_BurnNonLeafShouldRevert() public {
        uint256 r1 = rev.mintRoot(alice); // 1
        rev.mintChild(alice, r1); // 2

        // r1은 leaf 아님 → 소각 시도 시 revert("Not a leaf")
        vm.startPrank(alice);
        vm.expectRevert(bytes("Not a leaf"));
        rev.safeBurn(r1);
        vm.stopPrank();
    }

    function test_BatchBurn() public {
        uint256 r1 = rev.mintRoot(alice);  // 1
        uint256 c1 = rev.mintChild(alice, r1); // 2
        uint256 c2 = rev.mintChild(alice, r1); // 3

        // leaf만 소각 가능 → 먼저 c1, c2 를 배치 소각
        uint256[] memory ids = new uint256[](2);
        ids[0] = c1;
        ids[1] = c2;

        vm.prank(alice);
        rev.safeBatchBurn(ids);
        assertEq(rev.childrenCountOf(r1), 0);

        // 이제 r1(leaf)도 소각 가능
        vm.prank(alice);
        rev.safeBurn(r1);
    }

    function test_AccessControl_CanMintChildrenByOwnerOrAdmin() public {
        uint256 r1 = rev.mintRoot(alice);
        // bob은 현재 권한 없음 → 자식 민트 불가
        vm.prank(bob);
        vm.expectRevert(bytes("Not allowed to mint child"));
        rev.mintChild(bob, r1);

        // alice가 bob을 r1의 admin으로 등록
        vm.prank(alice);
        rev.setTokenAdmin(r1, bob, true);

        // 이제 bob은 r1 아래에 민트 가능
        vm.prank(bob);
        uint256 c1 = rev.mintChild(bob, r1);
        assertEq(rev.ownerOf(c1), bob);

        // burn 권한: owner/admin/approved
        // bob이 본인 토큰(c1) 소각 OK
        vm.prank(bob);
        rev.safeBurn(c1);
    }

    function test_CanMintRootByRootMinterOrOwner() public {
        // alice는 root 민트 권한 없음
        vm.prank(alice);
        vm.expectRevert(bytes("Not allowed to mint root"));
        rev.mintRoot(alice);

        // owner가 alice에 root 민트 권한 부여
        rev.setRootMinter(alice, true);

        // 이제 alice가 루트 민트 가능
        vm.prank(alice);
        uint256 rA = rev.mintRoot(alice);
        assertEq(rev.ownerOf(rA), alice);
        assertTrue(rev.isRoot(rA));
    }
}
