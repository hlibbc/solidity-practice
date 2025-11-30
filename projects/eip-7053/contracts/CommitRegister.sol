// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.4;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "./interfaces/IERC7053.sol";


/**
 * @title CommitRegister - 간단한 커밋 레지스트리 구현 (업그레이더블)
 * @notice
 *  - 자산 식별자(assetCid)별 커밋을 기록하고 이벤트로 발행합니다.
 *  - 커밋이 발생한 블록 번호 히스토리를 온체인 매핑에 저장합니다.
 * @dev
 *  - 업그레이더블 패턴을 위해 `Initializable`을 사용합니다.
 *  - 이벤트 `Commit`은 인터페이스를 그대로 상속하여 발행합니다.\n *  - ECDSA 유틸은 참고용으로 포함되어 있으나, 본 구현에서는 직접 사용하지 않습니다.\n */
contract CommitRegister is Initializable, IERC7053 {
    using ECDSA for bytes32; // (참고) 레퍼런스 코드에도 포함되어 있으나 이 구현에서는 직접 사용되지 않습니다.

    /// @notice assetCid 별 커밋이 발생한 블록 번호 기록
    mapping(string => uint256[]) public commitLogs;

    /// @inheritdoc IERC7053
    event Commit(address indexed recorder, string indexed assetCid, string commitData);

    /**
     * @notice 업그레이더블 초기화 함수. 상태 초기화가 필요할 경우 확장해 사용합니다.
     */
    function initialize() public initializer {}

    /// @inheritdoc IERC7053
    function commit(string memory assetCid, string memory commitData)
        public
        override
        returns (uint256 blockNumber)
    {
        emit Commit(msg.sender, assetCid, commitData);
        commitLogs[assetCid].push(block.number);
        return block.number;
    }

    /**
     * @notice 특정 `assetCid`의 커밋 블록 번호 히스토리를 반환합니다.
     * @param assetCid 커밋 대상 자산의 CID(식별자)
     * @return blocks 해당 자산의 커밋 기록 블록 번호 배열
     */
    function getCommits(string memory assetCid) public view returns (uint256[] memory) {
        return commitLogs[assetCid];
    }
}
