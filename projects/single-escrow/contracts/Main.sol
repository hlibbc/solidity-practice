// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./Escrow.sol";

/**
 * @title Main
 * @notice 단일 에스크로(1건) 생성을 오케스트레이션하는 메인 컨트랙트
 * @dev
 *  이 컨트랙트는 다음을 담당합니다:
 *  - `Escrow` 구현체(implementation)를 Clone으로 찍어내고
 *  - depositor(의뢰인)의 ERC20 토큰을 **permit(EIP-2612) + transferFrom** 조합으로 에스크로에 락(lock) 시킨 뒤
 *  - 이후 작업 완료/분쟁/출금 같은 상태 전이를 `Escrow`에 위임합니다.
 *
 * 핵심 설계 포인트:
 *  - `Escrow`의 모든 상태 전이 함수는 `onlyMain`(=이 컨트랙트만 호출 가능)로 묶여있습니다.
 *  - 토큰 락(lock)은 이 컨트랙트가 토큰을 보관(custody)하지 않고,
 *    곧바로 `depositor -> escrow`로 이동시킵니다.
 *
 * 전제 조건:
 *  - `token`은 `IERC20Permit`(EIP-2612)을 구현해야 합니다. (아니면 permit 단계에서 revert)
 *  - depositor는 `permit` 서명을 미리 만들어 전달해야 합니다.
 *
 * 주의사항:
 *  - `raiseDispute()`는 `Escrow`의 `completedAt`/`FINALIZATION_DELAY` 정보를 읽어
 *    "7일 이내" 조건을 여기서 강제합니다. (Escrow.forceLock 자체는 시간 검증을 하지 않음)
 */
contract Main {
    using SafeERC20 for IERC20;

    // =============================================================================
    // 에러(커스텀 에러)
    // =============================================================================
    error InvalidAddress();
    error InvalidAmount();
    error OnlyEscrowBeneficiary();
    error OnlyEscrowDepositor();
    error DisputeWindowPassed();

    // =============================================================================
    // 이벤트
    // =============================================================================
    event EscrowCreated(
        address indexed escrow,
        address indexed depositor,
        address indexed beneficiary,
        address token,
        uint256 amount
    );

    // =============================================================================
    // 스토리지
    // =============================================================================
    address public immutable escrowImplementation;

    // =============================================================================
    // 생성자
    // =============================================================================
    constructor(address _escrowImplementation) {
        if (_escrowImplementation == address(0)) revert InvalidAddress();
        escrowImplementation = _escrowImplementation;
    }

    /**
     * @notice 에스크로(Clone) 생성 + EIP-2612 permit 기반으로 자금을 에스크로에 락합니다.
     *
     * Flow(중요):
     *  1) escrow clone 생성
     *  2) escrow initialize(참여자/토큰/금액 확정)
     *  3) token.permit(depositor -> Main, amount)  (EIP-2612)
     *  4) token.transferFrom(depositor -> escrow, amount)  => 실제 락(lock)
     *  5) escrow.confirmLock()  (bookkeeping/검증 이벤트)
     *
     * @dev permit이 실패하는 대표 케이스:
     *  - token이 EIP-2612 미지원
     *  - 서명(v,r,s)이 잘못됨(도메인/체인ID/nonce/owner/spender/value/deadline 불일치)
     *  - deadline 만료
     */
    function createEscrow(
        address beneficiary,
        address token,
        uint256 amount,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external returns (address escrow) {
        if (beneficiary == address(0) || token == address(0)) {
            revert InvalidAddress();
        }
        if (amount == 0) {
            revert InvalidAmount();
        }

        escrow = Clones.clone(escrowImplementation);

        Escrow(escrow).initialize(
            address(this),
            msg.sender, // depositor
            beneficiary,
            token,
            amount
        );

        // Permit: depositor가 Main에게 amount 만큼 spend 권한을 부여(서명 기반, EIP-2612)
        IERC20Permit(token).permit(
            msg.sender,
            address(this),
            amount,
            deadline,
            v, r, s
        );

        // Lock: 실제 토큰 이동(depositor -> escrow). Main이 토큰을 보관하지 않습니다.
        IERC20(token).safeTransferFrom(msg.sender, escrow, amount);

        // Bookkeeping: 잔고 검증 + 이벤트 기록(감사/인덱싱에 유리)
        Escrow(escrow).confirmLock();

        emit EscrowCreated(escrow, msg.sender, beneficiary, token, amount);
    }

    /**
     * @notice 수혜자(beneficiary)가 작업 완료를 선언합니다 -> Escrow가 Ready 상태로 전환됩니다.
     * @dev Escrow 쪽은 onlyMain이므로, 여기서 beneficiary 권한 체크를 수행합니다.
     */
    function completeWork(address escrow) external {
        Escrow e = Escrow(escrow);

        if (msg.sender != e.beneficiary()) {
            revert OnlyEscrowBeneficiary();
        }
        e.requestUnlock();
    }

    /**
     * @notice 의뢰인(depositor)이 분쟁을 제기합니다(Ready 시점부터 7일 이내).
     * @dev 분쟁이 설정되면 `Escrow.claim()`은 영구적으로 revert 됩니다(현재 구현 기준).
     *
     * 검증 포인트:
     *  - msg.sender == escrow.depositor()
     *  - escrow.state() == Ready (작업완료 선언 이후만 의미 있음)
     *  - block.timestamp < completedAt + FINALIZATION_DELAY (7일 이내)
     */
    function raiseDispute(address escrow) external {
        Escrow e = Escrow(escrow);

        if (msg.sender != e.depositor()) {
            revert OnlyEscrowDepositor();
        }

        // Must be within dispute window since completedAt
        uint256 completedAt = uint256(e.completedAt());
        uint256 window = uint256(e.FINALIZATION_DELAY());

        // If completeWork not called yet, completedAt==0; in that case you can revert or allow.
        // Here we require it to be Ready for dispute to make sense.
        require(e.state() == Escrow.State.Ready, "not ready");

        if (block.timestamp >= completedAt + window) {
            revert DisputeWindowPassed();
        }
        e.forceLock();
    }

    /**
     * @notice 수혜자(beneficiary)가 출금합니다.
     * @dev 실제 타이밍(7일 경과) 및 분쟁 여부(disputed)는 Escrow 내부에서 강제합니다.
     */
    function withdrawEscrow(address escrow) external {
        Escrow e = Escrow(escrow);

        if (msg.sender != e.beneficiary()) {
            revert OnlyEscrowBeneficiary();
        }

        e.claim();
    }
}
