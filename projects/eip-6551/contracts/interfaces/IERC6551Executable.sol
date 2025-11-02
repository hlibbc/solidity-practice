// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.0;

/**
 * @title IERC6551Executable - ERC-6551 실행 인터페이스
 * @notice
 *  - TBA가 외부 컨트랙트/EOA로 콜을 위임 실행하기 위한 표준 함수
 */
interface IERC6551Executable {
    /**
     * @notice 대상 주소로 호출을 수행합니다.
     * @dev operation은 0(Call)만 지원하는 구현이 일반적입니다.
     * @param to 호출 대상 주소(컨트랙트/EOA)
     * @param value ETH 전송 값(wei)
     * @param data 호출 데이터(ABI 인코딩)
     * @param operation 0: call (그 외는 미지원일 수 있음)
     * @return 원시 반환 데이터(bytes)
     */
    function execute(address to, uint256 value, bytes calldata data, uint8 operation)
        external
        payable
        returns (bytes memory);
}
