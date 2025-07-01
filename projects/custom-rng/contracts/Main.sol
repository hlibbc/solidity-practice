// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title Main Controller Contract for Round Lifecycle
 * @notice This contract manages the lifecycle of a lottery or raffle round: 
 *     from start to end to settlement.
 * @dev It interacts with the Rng (Random Number Generator) contract via low-level ABI-encoded calls to:
 *     - Register a signed seed when starting a new round (commit)
 *     - Seal entropy at the end of the round (sealEntropy)
 *     - Verify the signed seed and finalize the random value (reveal)
 * @author hlibbc
 */

contract Main is Ownable {

    // ENUM 정의
    enum RoundStatus { 
        NotStarted, // 라운드 시작전
        Proceeding, // 진행중: startRound 에 의해 천이
        Drawing, // 개표중: endRound 에 의해 천이
        Claiming, // 당첨금수령중: settleRound 에 의해 천이
        Ended // 종료 
    }

    enum ContractTags {
        Rng, // Rng 컨트랙트
        TagMax
    }

    struct RoundManageInfo {
        RoundStatus status; // 라운드 상태
        uint64 endedAt; // 라운드 종료 시각 (endRound 호출시각)
        uint64 settledAt; // 라운드 정산 시각 (settleRound 호출시각)
        bytes32 winningHash; // 최종 랜덤값
    }

    mapping(uint256 => RoundManageInfo) public roundManageInfo; // 라운드별 정보관리 매핑변수

    address[] public managedContracts; // Inter-action 컨트랙트 리스트

    // 이벤트 정의
    event RoundStarted(uint256 indexed roundId);
    event RoundEnded(uint256 indexed roundId, address indexed msgSender);
    event RoundSettled(uint256 indexed roundId);

    /**
     * @notice constructor
     */
    constructor() Ownable(msg.sender) {}

    function setContracts(
        address[] memory _contractAddrs
    ) external onlyOwner {
        require(_contractAddrs.length == uint256(ContractTags.TagMax), "Incorrect Contract Nums");
        delete managedContracts;
        for(uint i = 0; i < uint256(ContractTags.TagMax); i++) {
            managedContracts.push(_contractAddrs[i]);
        }
    }

    /**
     * @notice Start a round
     * @dev onlyOwner
     * @param _roundId Round ID
     * @param _signature Data signature
     */
    function startRound(
        uint256 _roundId, 
        bytes calldata _signature
    ) external onlyOwner {
        RoundManageInfo storage info = roundManageInfo[_roundId];
        require(info.status == RoundStatus.NotStarted, "Round already started");

        // abi.encodeWithSelector 방식 호출
        (bool success, ) = managedContracts[uint8(ContractTags.Rng)].call(
            abi.encodeWithSelector(
                bytes4(keccak256("commit(uint256,bytes)")),
                _roundId,
                _signature
            )
        );
        require(success, "RNG: commit failed");

        info.status = RoundStatus.Proceeding;
        emit RoundStarted(_roundId);
    }

    /**
     * @notice End the round
     * @dev anyone can call
     * @param _roundId Round ID
     */
    function endRound(
        uint256 _roundId
    ) external {
        RoundManageInfo storage info = roundManageInfo[_roundId];
        require(info.status == RoundStatus.Proceeding, "Round not active");

        (bool success, ) = managedContracts[uint8(ContractTags.Rng)].call(
            abi.encodeWithSelector(
                bytes4(keccak256("sealEntropy(uint256,address)")),
                _roundId,
                msg.sender
            )
        );
        require(success, "RNG: sealEntropy failed");

        info.status = RoundStatus.Drawing;
        info.endedAt = uint64(block.timestamp);

        emit RoundEnded(_roundId, msg.sender);
    }

    /**
     * @notice Settle the round
     * @dev onlyOwner
     * @param _roundId Round ID
     * @param _randSeed seed value (Initially generated)
     */
    function settleRound(
        uint256 _roundId, 
        uint256 _randSeed
    ) external onlyOwner {
        RoundManageInfo storage info = roundManageInfo[_roundId];
        require(info.status == RoundStatus.Drawing, "Round not ready to settle");

        (bool success, ) = managedContracts[uint8(ContractTags.Rng)].call(
            abi.encodeWithSelector(
                bytes4(keccak256("reveal(uint256,uint256)")),
                _roundId,
                _randSeed
            )
        );
        require(success, "RNG: reveal failed");

        info.status = RoundStatus.Claiming;
        info.settledAt = uint64(block.timestamp);

        emit RoundSettled(_roundId);
    }

    /**
     * @notice View current status of a round
     * @param _roundId Round ID
     * @return status Current status of the round
     */
    function getRoundStatus(
        uint256 _roundId
    ) external view returns (RoundStatus status) {
        status = roundManageInfo[_roundId].status;
    }
}
