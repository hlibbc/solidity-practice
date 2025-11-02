// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/MyNFT.sol";
import "../../contracts/ERC6551Account.sol";
import "../../contracts/ERC6551Registry.sol";

/**
 * @title DemoTest - EIP-6551 TBA 데모 테스트
 * @notice
 *  - NFT 민트 → TBA 주소 예측/생성 일치성 → 자금 송금/실행 → 소유자 변경 후 권한 변경 검증
 * @dev
 *  - 본 프로젝트는 EIP-6551 TBA 개념 학습용 예제입니다 [[memory:7556543]].
 */
contract DemoTest is Test {
    address alice = address(0xA11CE);
    address bob   = address(0xB0B);

    MyNFT nft;
    ERC6551Account impl;
    ERC6551Registry reg;

    /**
     * @notice 공통 초기화: 잔액 세팅 및 기본 컨트랙트 배포
     */
    function setUp() public {
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);

        vm.startPrank(alice);
        nft = new MyNFT();
        impl = new ERC6551Account();
        reg  = new ERC6551Registry();
        vm.stopPrank();
    }

    /**
     * @notice 통합 플로우 테스트
     * @dev 시나리오
     *  1) Alice가 NFT 1개 민트
     *  2) Registry.account() 예측 주소와 createAccount() 생성 주소가 동일
     *  3) TBA로 ETH 송금, 임의 Target에 execute() 호출 성공
     *  4) NFT 소유권을 Bob에게 이전 → Alice 실행 권한 상실, Bob 실행 권한 획득
     */
    function test_flow() public {
        vm.startPrank(alice);

        // 1) 민트
        uint256 id = nft.mint(alice);

        // 2) 주소 예측/생성 동일성 확인
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

/**
 * @title Target - execute() 호출 대상 더미 컨트랙트
 * @notice 수신자/값/데이터를 이벤트로 기록하는 간단한 타깃
 */
contract Target {
    event Ping(address from, uint256 val, bytes data);
    /**
     * @notice 임의 페이로드를 수신하며 이벤트를 발생시킵니다.
     * @param data 호출자 임의 데이터
     */
    function ping(bytes calldata data) external payable {
        emit Ping(msg.sender, msg.value, data);
    }
}
