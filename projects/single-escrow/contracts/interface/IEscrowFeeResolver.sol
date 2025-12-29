// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IEscrowFeeResolver {
    /// Def. error
    error FeeQueryFailed(); // getEscrowFee 쿼리 실패
    error InvalidFee(); // getEscrowFee 결과값이 에스크로 보유량보다 클 경우

    /// Def. function
    /**
     * @notice
     */
    function getEscrowFee(
        address escrow,
        address token,
        uint256 grossAmount
    ) external view returns (uint256 feeAmount);
}
