// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/Rng.sol";
import "../../contracts/Main.sol";

contract RngTest is Test {
    Rng public rng;
    Main public main;
    
    address public mainAddr;
    address public signer;
    address public user1;
    address public user2;
    uint256 public signerPrivateKey;
    
    uint256 public roundId = 1;
    uint256 public randSeed = 12345;
    
    // EIP-712 서명을 위한 구조체
    struct SigData {
        uint256 roundId;
        uint256 randSeed;
    }
    
    function setUp() public {
        mainAddr = makeAddr("main");
        user1 = makeAddr("user1");
        user2 = makeAddr("user2");
        
        // signer의 프라이빗키 생성
        signerPrivateKey = 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef;
        signer = vm.addr(signerPrivateKey);
        
        rng = new Rng(mainAddr, signer);
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
        assertEq(rng.mainAddr(), mainAddr);
        assertEq(rng.signerAddr(), signer);
        assertEq(rng.ENTROPY_FACTOR1(), 6);
        assertEq(rng.ENTROPY_FACTOR2(), 16);
    }
    
    function test_Constructor_RevertIfInvalidMainAddr() public {
        vm.expectRevert("Invalid Main address");
        new Rng(address(0), signer);
    }
    
    function test_Constructor_RevertIfInvalidSignerAddr() public {
        vm.expectRevert("Invalid Signer address");
        new Rng(mainAddr, address(0));
    }
    
    function test_Commit() public {
        vm.startPrank(mainAddr);
        
        bytes memory signature = createValidSignature(roundId, randSeed);
        
        vm.expectEmit(true, false, false, false);
        emit Rng.Committed(roundId);
        rng.commit(roundId, signature);
        
        (,,,, bytes memory storedSignature) = rng.getRoundRngInfo(roundId);
        assertEq(storedSignature.length, 65);
        
        vm.stopPrank();
    }
    
    function test_Commit_RevertIfNotMain() public {
        vm.startPrank(user1);
        
        bytes memory signature = createValidSignature(roundId, randSeed);
        
        vm.expectRevert("Not Main contract");
        rng.commit(roundId, signature);
        
        vm.stopPrank();
    }
    
    function test_Commit_RevertIfAlreadyCommitted() public {
        vm.startPrank(mainAddr);
        
        bytes memory signature = createValidSignature(roundId, randSeed);
        
        rng.commit(roundId, signature);
        
        vm.expectRevert("Already committed");
        rng.commit(roundId, signature);
        
        vm.stopPrank();
    }
    
    function test_SealEntropy() public {
        vm.startPrank(mainAddr);
        
        // 먼저 commit
        bytes memory signature = createValidSignature(roundId, randSeed);
        rng.commit(roundId, signature);
        
        vm.stopPrank();
        
        // sealEntropy 호출
        vm.startPrank(mainAddr);
        vm.roll(100);
        vm.expectEmit(true, false, true, false);
        emit Rng.SealedEntropy(roundId, user1, bytes32(0)); // salt는 블록해시이므로 예측 불가
        rng.sealEntropy(roundId, user1);
        
        (address ender, uint256 blockTime, bytes32 salt, bytes32 finalRands,) = rng.getRoundRngInfo(roundId);
        assertEq(ender, user1);
        assertEq(blockTime, block.timestamp);
        assertTrue(salt != bytes32(0));
        assertEq(finalRands, bytes32(0));
        
        vm.stopPrank();
    }
    
    function test_SealEntropy_RevertIfNotMain() public {
        vm.startPrank(user1);
        
        vm.expectRevert("Not Main contract");
        rng.sealEntropy(roundId, user1);
        
        vm.stopPrank();
    }
    
    function test_SealEntropy_RevertIfInvalidEnder() public {
        vm.startPrank(mainAddr);
        
        vm.expectRevert("Invalid Ender address");
        rng.sealEntropy(roundId, address(0));
        
        vm.stopPrank();
    }
    
    function test_SealEntropy_RevertIfNotCommitted() public {
        vm.startPrank(mainAddr);
        
        vm.expectRevert("Not committed Yet");
        rng.sealEntropy(roundId, user1);
        
        vm.stopPrank();
    }
    
    function test_SealEntropy_RevertIfAlreadySealed() public {
        vm.startPrank(mainAddr);
        
        // commit
        bytes memory signature = createValidSignature(roundId, randSeed);
        rng.commit(roundId, signature);
        
        // 첫 번째 sealEntropy
        rng.sealEntropy(roundId, user1);
        
        // 두 번째 sealEntropy (실패해야 함)
        vm.expectRevert("Already sealed");
        rng.sealEntropy(roundId, user2);
        
        vm.stopPrank();
    }
    
    function test_Reveal() public {
        vm.startPrank(mainAddr);
        
        // commit
        bytes memory signature = createValidSignature(roundId, randSeed);
        rng.commit(roundId, signature);
        
        // sealEntropy
        rng.sealEntropy(roundId, user1);
        
        vm.stopPrank();
        
        // reveal
        vm.startPrank(mainAddr);
        
        vm.expectEmit(true, false, false, false);
        emit Rng.Revealed(roundId, randSeed, bytes32(0)); // finalNum은 예측 불가
        rng.reveal(roundId, randSeed);
        
        (,,, bytes32 finalRands,) = rng.getRoundRngInfo(roundId);
        assertTrue(finalRands != bytes32(0));
        
        vm.stopPrank();
    }
    
    function test_Reveal_RevertIfNotMain() public {
        vm.startPrank(user1);
        
        vm.expectRevert("Not Main contract");
        rng.reveal(roundId, randSeed);
        
        vm.stopPrank();
    }
    
    function test_Reveal_RevertIfAlreadyRevealed() public {
        vm.startPrank(mainAddr);
        
        // commit
        bytes memory signature = createValidSignature(roundId, randSeed);
        rng.commit(roundId, signature);
        
        // sealEntropy
        rng.sealEntropy(roundId, user1);
        
        // 첫 번째 reveal
        rng.reveal(roundId, randSeed);
        
        // 두 번째 reveal (실패해야 함)
        vm.expectRevert("Already revealed");
        rng.reveal(roundId, randSeed);
        
        vm.stopPrank();
    }
    
    function test_Reveal_RevertIfInvalidSignatureLength() public {
        vm.startPrank(mainAddr);
        
        // 잘못된 길이의 signature로 commit
        bytes memory signature = new bytes(64); // 65가 아님
        signature[0] = 0x1b;
        rng.commit(roundId, signature);
        
        // sealEntropy
        rng.sealEntropy(roundId, user1);
        
        // reveal (실패해야 함)
        vm.expectRevert("Invalid signature length");
        rng.reveal(roundId, randSeed);
        
        vm.stopPrank();
    }
    
    function test_GetRoundRngInfo() public {
        vm.startPrank(mainAddr);
        
        // 초기 상태 확인
        (address ender, uint256 blockTime, bytes32 salt, bytes32 finalRands, bytes memory signature) = rng.getRoundRngInfo(roundId);
        assertEq(ender, address(0));
        assertEq(blockTime, 0);
        assertEq(salt, bytes32(0));
        assertEq(finalRands, bytes32(0));
        assertEq(signature.length, 0);
        
        // commit
        bytes memory sig = createValidSignature(roundId, randSeed);
        rng.commit(roundId, sig);
        
        (ender, blockTime, salt, finalRands, signature) = rng.getRoundRngInfo(roundId);
        assertEq(ender, address(0));
        assertEq(blockTime, 0);
        assertEq(salt, bytes32(0));
        assertEq(finalRands, bytes32(0));
        assertEq(signature.length, 65);
        
        // sealEntropy
        vm.roll(100);
        rng.sealEntropy(roundId, user1);
        
        (ender, blockTime, salt, finalRands, signature) = rng.getRoundRngInfo(roundId);
        assertEq(ender, user1);
        assertEq(blockTime, block.timestamp);
        assertTrue(salt != bytes32(0));
        assertEq(finalRands, bytes32(0));
        assertEq(signature.length, 65);
        
        // reveal
        rng.reveal(roundId, randSeed);
        
        (ender, blockTime, salt, finalRands, signature) = rng.getRoundRngInfo(roundId);
        assertEq(ender, user1);
        assertEq(blockTime, block.timestamp);
        assertTrue(salt != bytes32(0));
        assertTrue(finalRands != bytes32(0));
        assertEq(signature.length, 65);
        
        vm.stopPrank();
    }
    
    function test_CompleteRngLifecycle() public {
        vm.startPrank(mainAddr);
        
        // 1. Commit
        bytes memory signature = createValidSignature(roundId, randSeed);
        rng.commit(roundId, signature);
        
        // 2. SealEntropy
        vm.roll(100);
        rng.sealEntropy(roundId, user1);
        
        // 3. Reveal
        rng.reveal(roundId, randSeed);
        
        // 최종 상태 확인
        (address ender, uint256 blockTime, bytes32 salt, bytes32 finalRands, bytes memory sig) = rng.getRoundRngInfo(roundId);
        assertEq(ender, user1);
        assertEq(blockTime, block.timestamp);
        assertTrue(salt != bytes32(0));
        assertTrue(finalRands != bytes32(0));
        assertEq(sig.length, 65);
        
        vm.stopPrank();
    }
    
    function test_Constants() public {
        assertEq(rng.ENTROPY_FACTOR1(), 6);
        assertEq(rng.ENTROPY_FACTOR2(), 16);
        
        bytes32 expectedTypeHash = keccak256("SigData(uint256 roundId,uint256 randSeed)");
        assertEq(rng.SIGDATA_TYPEHASH(), expectedTypeHash);
    }
} 