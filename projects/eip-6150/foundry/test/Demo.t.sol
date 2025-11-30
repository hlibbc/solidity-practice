// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {MyERC6150} from "../../contracts/MyERC6150.sol";

/**
 * @title RevisionNFT6150Test - ERC-6150 기능 테스트
 * @notice
 *  - `MyERC6150`의 핵심 기능(루트/자식 민트, 부모 변경, 소각, 접근제어, 열거/조회)을 순차적으로 검증합니다.
 *  - 트리 구조 제약(순환 방지, self-parent 금지), 리프 전용 소각 규칙 등을 포함해 행동/에러 케이스를 함께 확인합니다.
 * @dev
 *  - Foundry `Test`를 상속하여 `vm` 헬퍼를 사용합니다.
 *  - 계정은 `makeAddr`로 가독성 있게 생성하고, 필요한 경우 `vm.prank`/`vm.startPrank`로 msg.sender를 전환합니다.
 *  - 각 테스트는 독립적으로 수행되며, `setUp()`에서 공통 배포/권한 설정을 초기화합니다.
 */
contract RevisionNFT6150Test is Test {
    MyERC6150 internal rev;
    address internal owner;
    address internal alice;
    address internal bob;

    /**
     * @notice 공통 초기화: 컨트랙트 배포 및 루트 민터 권한 부여
     * @dev
     *  - `owner=address(this)`로 테스트 컨트랙트 자체를 오너로 사용합니다.
     *  - `alice`, `bob`은 테스트 시나리오에 따라 소유자/관리자/호출자 역할을 수행합니다.
     */
    function setUp() public {
        owner = address(this);
        alice = makeAddr("alice");
        bob   = makeAddr("bob");

        rev = new MyERC6150("Rev6150", "REV");

        // 테스트 편의를 위해 owner를 루트 민터로 등록
        rev.setRootMinter(owner, true);
    }

    /**
     * @notice 루트/자식 민트 및 기본 조회 기능 검증
     * @dev
     *  - r1 루트 민트 → 소유/루트/리프 여부 확인
     *  - r1 하위에 c1 자식 민트 → 부모/리프/열거/인덱스 조회 검증
     */
    function test_MintRootAndChildAndQuery() public {
        uint256 r1 = rev.mintRoot(alice);
        assertEq(r1, 1);
        assertEq(rev.ownerOf(r1), alice);
        assertTrue(rev.isRoot(r1));
        assertTrue(rev.isLeaf(r1)); // 아직 자식 없음

        vm.prank(alice);
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

    /**
     * @notice 부모 변경(ParentTransfer) 기능 및 제약 검증
     * @dev
     *  - r1 밑 c1 생성 후, r2를 새 부모로 지정 → 이동 성공
     *  - 순환 방지: 하위 노드를 부모로 지정하려 할 때 revert
     *  - self-parent 금지: 자기 자신을 부모로 지정 시 revert
     */
    function test_TransferParent() public {
        uint256 r1 = rev.mintRoot(alice); // 1
        vm.prank(alice);
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

    /**
     * @notice 리프 전용 소각 규칙 검증(리프 → OK, 이후 루트도 리프가 되면 OK)
     * @dev
     *  - c1(리프) 소각 성공 → r1이 리프가 된 뒤 r1 소각 성공
     *  - 소각 후 존재하지 않는 토큰 조회 시 revert
     */
    function test_BurnLeaf_RevertWhenNonLeaf() public {
        uint256 r1 = rev.mintRoot(alice); // 1
        vm.prank(alice);
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

    /**
     * @notice 리프가 아닌 토큰 소각 시 revert 확인
     * @dev
     *  - r1 하위에 자식이 존재하는 상태에서 r1 소각 시도 → "Not a leaf"로 revert
     */
    function test_BurnNonLeafShouldRevert() public {
        uint256 r1 = rev.mintRoot(alice); // 1
        vm.prank(alice);
        rev.mintChild(alice, r1); // 2

        // r1은 leaf 아님 → 소각 시도 시 revert("Not a leaf")
        vm.startPrank(alice);
        vm.expectRevert(bytes("Not a leaf"));
        rev.safeBurn(r1);
        vm.stopPrank();
    }

    /**
     * @notice 배치 소각 기능 검증
     * @dev
     *  - 자식들(c1,c2) 먼저 배치 소각 → r1이 리프가 되면 r1 소각 가능
     */
    function test_BatchBurn() public {
        uint256 r1 = rev.mintRoot(alice);  // 1
        vm.startPrank(alice);
        uint256 c1 = rev.mintChild(alice, r1); // 2
        uint256 c2 = rev.mintChild(alice, r1); // 3
        vm.stopPrank();

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

    /**
     * @notice 접근 제어: 특정 부모 하위 자식 민트 권한(소유자/관리자) 검증
     * @dev
     *  - bob은 초기엔 권한 없음 → 민트 시도 시 revert
     *  - alice가 bob을 r1의 admin으로 등록 → bob이 r1 하위에 민트 가능
     *  - burn 권한(소유자/관리자/승인자) 확인을 위해 bob이 본인 토큰(c1) 소각
     */
    function test_OnlyRootOwnerCanMintChildren() public {
        uint256 r1 = rev.mintRoot(alice);
        // bob은 r1 하위 자식 민트 불가(루트 소유자가 아님)
        vm.prank(bob);
        vm.expectRevert(bytes("Not allowed to mint child"));
        rev.mintChild(bob, r1);

        // 루트 소유자 alice는 r1 하위 자식 민트 가능 (수령자는 bob)
        vm.prank(alice);
        uint256 c1 = rev.mintChild(bob, r1);
        assertEq(rev.ownerOf(c1), bob);

        // bob을 admin으로 등록해도 민트 권한은 부여되지 않음(여전히 루트 소유자만)
        vm.prank(alice);
        rev.setTokenAdmin(r1, bob, true);
        vm.prank(bob);
        vm.expectRevert(bytes("Not allowed to mint child"));
        rev.mintChild(bob, r1);

        // bob은 본인 소유 토큰(c1) 소각 가능(소유/승인/관리자 권한)
        vm.prank(bob);
        rev.safeBurn(c1);
    }

    // test_CanMintRootByAnyone: 확장 케이스(test_CanMintRootByAnyone_Extended)로 대체됨

    /**
     * @notice 루트 민트 정책 강화 검증
     * @dev
     *  - 서로 다른 EOA가 각각 자유롭게 루트 민트 가능
     *  - 수령자(to) 임의 지정 가능
     *  - setRootMinter(true/false)와 무관하게 항상 가능
     *  - 컨트랙트 owner의 특권 경로 없음(자식 민트 권한에도 영향 없음)
     */
    function test_CanMintRootByAnyone() public {
        // alice가 bob에게 루트 민트(to override)
        vm.prank(alice);
        uint256 r1 = rev.mintRoot(bob);
        assertTrue(rev.isRoot(r1));
        assertEq(rev.ownerOf(r1), bob);

        // bob이 alice에게 루트 민트
        vm.prank(bob);
        uint256 r2 = rev.mintRoot(alice);
        assertTrue(rev.isRoot(r2));
        assertEq(rev.ownerOf(r2), alice);

        // setRootMinter로 권한을 꺼도(또는 켜도) 루트 민트에는 영향 없음
        rev.setRootMinter(alice, false);
        rev.setRootMinter(bob, false);

        vm.prank(alice);
        uint256 r3 = rev.mintRoot(alice);
        assertTrue(rev.isRoot(r3));
        assertEq(rev.ownerOf(r3), alice);

        vm.prank(bob);
        uint256 r4 = rev.mintRoot(bob);
        assertTrue(rev.isRoot(r4));
        assertEq(rev.ownerOf(r4), bob);

        // 컨트랙트 owner는 루트 소유자가 아니므로 alice의 루트 하위 자식 민트 불가
        // (특권 경로 없음)
        vm.expectRevert(bytes("Not allowed to mint child"));
        rev.mintChild(address(this), r2);
    }
}
