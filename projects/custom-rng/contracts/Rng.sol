// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title Rng (Random Number Generator) Contract
 * @notice This smart contract is responsible for generating random numbers in rounds.
 * @dev Application of a signature-based algorithm that can verify the integrity of the seed
 * Due to the entropy added in the middle of the round, 
 * even the seed generator cannot infer the final random value.
 * @author hlibbc
 */
contract Rng is EIP712 {
    using ECDSA for bytes32;

    /// constant 정의
    uint256 public constant ENTROPY_FACTOR1 = 6;
    uint256 public constant ENTROPY_FACTOR2 = 16;
    bytes32 public constant SIGDATA_TYPEHASH =
        keccak256("SigData(uint256 roundId,uint256 randSeed)");

    address public mainAddr; // 라운드시작, 종료, 정산을 관장할 컨트랙트
    address public signerAddr; // commit 시 기록될 시그니처 주인

    // 라운드별 기록될 Rng 정보
    struct RoundRngInfo {
        address ender; // 라운드를 종료시킨 참여자
        uint256 blockTime; // 라운드 종료 블록 타임스탬프
        bytes32 salt; // Salt값: 라운드종료 블록의 50블록 이전 해시
        bytes32 finalRands; // 최종 난수 (reveal 이후 확정됨)
        bytes signature; // 라운드 시작 시 입력된 RoundSeedInfo에 대한 signer 서명
    }

    mapping(uint256 => RoundRngInfo) public roundRngInfo; // 라운드별 RngInfo 저장용 매핑변수

    // 이벤트 정의
    event Committed(
        uint256 indexed roundId
    );
    event SealedEntropy(
        uint256 indexed roundId,
        address indexed ender,
        bytes32 salt
    );
    event Revealed(
        uint256 indexed roundId, 
        uint256 indexed seed, 
        bytes32 finalNum
    );

    /**
     * @notice constructor
     */
    constructor(
        address _mainAddr,
        address _signerAddr
    ) EIP712("Custom-Rng", "1") {
        require(_mainAddr != address(0), "Invalid Main address");
        require(_signerAddr != address(0), "Invalid Signer address");
        mainAddr = _mainAddr;
        signerAddr = _signerAddr;
    }

    modifier onlyMain() {
        require(msg.sender == mainAddr, "Not Main contract");
        _;
    }

    /** 
     * @notice Store the signature signed for the data at the start of the round.
     * @dev 
     * Signature data type: 
     * struct SigData {
     *    uint256 roundId;
     *    uint256 seed;
     * }
     */
    function commit(
        uint256 _roundId, 
        bytes calldata _signature
    ) external onlyMain {
        require(roundRngInfo[_roundId].signature.length == 0, "Already committed");
        roundRngInfo[_roundId].signature = _signature;
        emit Committed(_roundId);
    }

    /**
     * @notice Add entropy at the end of the round.
     * @dev List of entropy to be added
     * - ender (address: 20bytes)
     * - salt: keccak256(abi.encodePacked(block.timestamp, blockhash(selectedBlockNum)))
     */
    function sealEntropy(
        uint256 _roundId, 
        address _ender
    ) external onlyMain {
        require(_ender != address(0), "Invalid Ender address");
        require(roundRngInfo[_roundId].signature.length > 0, "Not committed Yet");
        require(roundRngInfo[_roundId].ender == address(0), "Already sealed");

        uint256 selectedBlockNum = (block.number > 50)? (block.number - 50) : (1);
        bytes32 salt = blockhash(selectedBlockNum);
        roundRngInfo[_roundId].blockTime = block.timestamp;
        roundRngInfo[_roundId].salt = salt;
        roundRngInfo[_roundId].ender = _ender;
        emit SealedEntropy(_roundId, _ender, salt);
    }

    /// @notice 라운드 정산 시 reveal (최종 난수 확정)
    function reveal(
        uint256 _roundId, 
        uint256 _randSeed
    ) external onlyMain {
        RoundRngInfo storage info = roundRngInfo[_roundId];

        require(info.finalRands == bytes32(0), "Already revealed");
        require(info.signature.length == 65, "Invalid signature length");

        // EIP-712 hash 생성
        bytes32 structHash = keccak256(abi.encode(
            SIGDATA_TYPEHASH,
            _roundId,
            _randSeed
        ));

        bytes32 digest = _hashTypedDataV4(structHash);

        // 서명 복원
        address recovered = ECDSA.recover(digest, info.signature);
        require(recovered == signerAddr, "Invalid signature");

        // 추가 entropy 생성
        bytes32 entropy1 = (block.number > ENTROPY_FACTOR1)? (blockhash(block.number - ENTROPY_FACTOR1)) : (bytes32(0));
        bytes32 entropy2 = (block.number > ENTROPY_FACTOR2)? (blockhash(block.number - ENTROPY_FACTOR2)) : (bytes32(0));

        // 최종 난수 생성
        bytes32 finalRng = keccak256(
            abi.encodePacked(_randSeed, info.ender, info.salt, entropy1, entropy2)
        );

        info.finalRands = finalRng;
        emit Revealed(_roundId, _randSeed, finalRng);
    }


    /// @notice 라운드별 난수정보 확인
    function getRoundRngInfo(uint256 _roundId) external view returns (
        address ender,
        uint256 blockTime,
        bytes32 salt,
        bytes32 finalRands,
        bytes memory signature
    ) {
        RoundRngInfo storage info = roundRngInfo[_roundId];
        return (
            info.ender,
            info.blockTime,
            info.salt,
            info.finalRands,
            info.signature
        );
    }
}
