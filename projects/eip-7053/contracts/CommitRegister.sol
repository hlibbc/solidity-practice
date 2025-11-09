// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.4;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "./interfaces/IERC7053.sol";


contract CommitRegister is Initializable, IERC7053 {
    using ECDSA for bytes32; // (참고) 레퍼런스 코드에도 포함되어 있으나 이 구현에서는 직접 사용되지 않습니다.

    /// @notice assetCid 별 커밋이 발생한 블록 번호 기록
    mapping(string => uint256[]) public commitLogs;

    /// @inheritdoc IERC7053
    event Commit(address indexed recorder, string indexed assetCid, string commitData);

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

    /// @notice 특정 assetCid의 커밋 블록 번호 히스토리 조회
    function getCommits(string memory assetCid) public view returns (uint256[] memory) {
        return commitLogs[assetCid];
    }
}
