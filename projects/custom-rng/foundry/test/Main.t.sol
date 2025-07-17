// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/Main.sol";
import "../../contracts/Rng.sol";

contract MainTest is Test {
    Main public main;
    Rng public rng;
    
    address public owner;
    address public user1;
    address public user2;
    address public signer;
    uint256 public signerPrivateKey;
    
    uint256 public roundId = 1;
    
    function setUp() public {
        owner = makeAddr("owner");
        user1 = makeAddr("user1");
        user2 = makeAddr("user2");
        
        // signer의 프라이빗키 생성
        signerPrivateKey = 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef;
        signer = vm.addr(signerPrivateKey);
        
        vm.startPrank(owner);
        
        // 컨트랙트 배포
        main = new Main();
        rng = new Rng(address(main), signer);
        
        // Main 컨트랙트에 Rng 주소 설정
        address[] memory contracts = new address[](1);
        contracts[0] = address(rng);
        main.setContracts(contracts);
        
        vm.stopPrank();
    }
    
    function createValidSignature(uint256 _roundId, uint256 _randSeed) internal view returns (bytes memory) {
        // EIP-712 구조체 해시 생성
        bytes32 structHash = keccak256(abi.encode(
            rng.SIGDATA_TYPEHASH(),
            _roundId,
            _randSeed
        ));
        
        // EIP-712 도메인 해시 생성
        bytes32 domainHash = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256(bytes("Custom-Rng")),
            keccak256(bytes("1")),
            block.chainid,
            address(rng)
        ));
        
        // 최종 해시 생성
        bytes32 digest = keccak256(abi.encodePacked(
            "\x19\x01",
            domainHash,
            structHash
        ));
        
        // 서명 생성
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPrivateKey, digest);
        return abi.encodePacked(r, s, v);
    }
    
    function test_Constructor() public {
        assertEq(main.owner(), owner);
    }
    
    function test_SetContracts() public {
        vm.startPrank(owner);
        
        address[] memory contracts = new address[](1);
        contracts[0] = address(rng);
        main.setContracts(contracts);
        
        assertEq(main.managedContracts(0), address(rng));
        vm.stopPrank();
    }
    
    function test_SetContracts_RevertIfNotOwner() public {
        vm.startPrank(user1);
        
        address[] memory contracts = new address[](1);
        contracts[0] = address(rng);
        
        vm.expectRevert();
        main.setContracts(contracts);
        
        vm.stopPrank();
    }
    
    function test_SetContracts_RevertIfIncorrectLength() public {
        vm.startPrank(owner);
        
        address[] memory contracts = new address[](2);
        contracts[0] = address(rng);
        contracts[1] = address(rng);
        
        vm.expectRevert("Incorrect Contract Nums");
        main.setContracts(contracts);
        
        vm.stopPrank();
    }
    
    function test_StartRound() public {
        vm.startPrank(owner);
        
        // 유효한 서명 생성
        uint256 randSeed = 12345;
        bytes memory signature = createValidSignature(roundId, randSeed);
        
        vm.expectEmit(true, false, false, false);
        emit Main.RoundStarted(roundId);
        main.startRound(roundId, signature);
        
        assertEq(uint256(main.getRoundStatus(roundId)), uint256(Main.RoundStatus.Proceeding));
        
        vm.stopPrank();
    }
    
    function test_StartRound_RevertIfNotOwner() public {
        vm.startPrank(user1);
        
        uint256 randSeed = 12345;
        bytes memory signature = createValidSignature(roundId, randSeed);
        
        vm.expectRevert();
        main.startRound(roundId, signature);
        
        vm.stopPrank();
    }
    
    function test_StartRound_RevertIfAlreadyStarted() public {
        vm.startPrank(owner);
        
        uint256 randSeed = 12345;
        bytes memory signature = createValidSignature(roundId, randSeed);
        
        main.startRound(roundId, signature);
        
        vm.expectRevert("Round already started");
        main.startRound(roundId, signature);
        
        vm.stopPrank();
    }
    
    function test_EndRound() public {
        vm.startPrank(owner);
        
        // 라운드 시작
        uint256 randSeed = 12345;
        bytes memory signature = createValidSignature(roundId, randSeed);
        main.startRound(roundId, signature);
        
        vm.stopPrank();
        
        // 라운드 종료
        vm.startPrank(user1);
        
        vm.expectEmit(true, false, true, false);
        emit Main.RoundEnded(roundId, user1);
        main.endRound(roundId);
        
        assertEq(uint256(main.getRoundStatus(roundId)), uint256(Main.RoundStatus.Drawing));
        
        vm.stopPrank();
    }
    
    function test_EndRound_RevertIfNotActive() public {
        vm.startPrank(user1);
        
        vm.expectRevert("Round not active");
        main.endRound(roundId);
        
        vm.stopPrank();
    }
    
    function test_SettleRound() public {
        vm.startPrank(owner);
        
        // 라운드 시작
        uint256 randSeed = 12345;
        bytes memory signature = createValidSignature(roundId, randSeed);
        main.startRound(roundId, signature);
        
        vm.stopPrank();
        
        // 라운드 종료
        vm.startPrank(user1);
        main.endRound(roundId);
        vm.stopPrank();
        
        // 라운드 정산
        vm.startPrank(owner);
        
        vm.expectEmit(true, false, false, false);
        emit Main.RoundSettled(roundId);
        main.settleRound(roundId, randSeed);
        
        assertEq(uint256(main.getRoundStatus(roundId)), uint256(Main.RoundStatus.Claiming));
        
        vm.stopPrank();
    }
    
    function test_SettleRound_RevertIfNotOwner() public {
        vm.startPrank(owner);
        
        // 라운드 시작
        uint256 randSeed = 12345;
        bytes memory signature = createValidSignature(roundId, randSeed);
        main.startRound(roundId, signature);
        
        vm.stopPrank();
        
        // 라운드 종료
        vm.startPrank(user1);
        main.endRound(roundId);
        vm.stopPrank();
        
        // 라운드 정산 (권한 없음)
        vm.startPrank(user1);
        
        vm.expectRevert();
        main.settleRound(roundId, randSeed);
        
        vm.stopPrank();
    }
    
    function test_SettleRound_RevertIfNotReady() public {
        vm.startPrank(owner);
        
        uint256 randSeed = 12345;
        
        vm.expectRevert("Round not ready to settle");
        main.settleRound(roundId, randSeed);
        
        vm.stopPrank();
    }
    
    function test_GetRoundStatus() public {
        // 초기 상태
        assertEq(uint256(main.getRoundStatus(roundId)), uint256(Main.RoundStatus.NotStarted));
        
        vm.startPrank(owner);
        
        // 라운드 시작
        uint256 randSeed = 12345;
        bytes memory signature = createValidSignature(roundId, randSeed);
        main.startRound(roundId, signature);
        
        assertEq(uint256(main.getRoundStatus(roundId)), uint256(Main.RoundStatus.Proceeding));
        
        vm.stopPrank();
        
        // 라운드 종료
        vm.startPrank(user1);
        main.endRound(roundId);
        assertEq(uint256(main.getRoundStatus(roundId)), uint256(Main.RoundStatus.Drawing));
        
        vm.stopPrank();
        
        // 라운드 정산
        vm.startPrank(owner);
        main.settleRound(roundId, randSeed);
        assertEq(uint256(main.getRoundStatus(roundId)), uint256(Main.RoundStatus.Claiming));
        
        vm.stopPrank();
    }
    
    function test_CompleteRoundLifecycle() public {
        vm.startPrank(owner);
        
        // 1. 라운드 시작
        uint256 randSeed = 12345;
        bytes memory signature = createValidSignature(roundId, randSeed);
        main.startRound(roundId, signature);
        
        assertEq(uint256(main.getRoundStatus(roundId)), uint256(Main.RoundStatus.Proceeding));
        
        vm.stopPrank();
        
        // 2. 라운드 종료
        vm.startPrank(user1);
        main.endRound(roundId);
        assertEq(uint256(main.getRoundStatus(roundId)), uint256(Main.RoundStatus.Drawing));
        
        vm.stopPrank();
        
        // 3. 라운드 정산
        vm.startPrank(owner);
        main.settleRound(roundId, randSeed);
        assertEq(uint256(main.getRoundStatus(roundId)), uint256(Main.RoundStatus.Claiming));
        
        vm.stopPrank();
    }
} 