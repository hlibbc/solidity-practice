// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.4;

/**
 * @title IERC7053 - 커밋 레지스트리 인터페이스
 * @notice
 *  - 자산 식별자(assetCid)에 대한 커밋(commit) 정보를 기록/조회하기 위한 최소 인터페이스를 정의합니다.
 *  - 커밋은 이벤트로 발행되며, 구현체에 따라 온체인 스토리지 기록이 병행될 수 있습니다.
 * @dev
 *  - 구현 컨트랙트는 `Commit` 이벤트를 발행해야 하며, `commit` 호출 시 블록 번호를 반환해야 합니다.
 */
interface IERC7053 {
    /**
     * @notice 새로운 커밋이 기록될 때 발생합니다.
     * @param recorder 커밋을 기록한 주소(`msg.sender`)
     * @param assetCid 커밋 대상 자산의 CID(식별자)
     * @param commitData 커밋 데이터(예: 메타데이터, 해시, 설명)
     */
    event Commit(address indexed recorder, string indexed assetCid, string commitData);

    /**
     * @notice 주어진 `assetCid`에 대해 커밋을 기록하고, 해당 트랜잭션이 포함될 블록 번호를 반환합니다.
     * @param assetCid 커밋 대상 자산의 CID(식별자)
     * @param commitData 커밋 데이터(예: 메타데이터, 해시, 설명)
     * @return blockNumber 커밋이 기록된 블록 번호
     */
    function commit(string memory assetCid, string memory commitData) external returns (uint256 blockNumber);
}