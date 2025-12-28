// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./Escrow.sol";

contract Main {
    using SafeERC20 for IERC20;

    error InvalidAddress();
    error InvalidAmount();
    error OnlyEscrowBeneficiary();
    error OnlyEscrowDepositor();
    error DisputeWindowPassed();

    event EscrowCreated(
        address indexed escrow,
        address indexed depositor,
        address indexed beneficiary,
        address token,
        uint256 amount
    );

    address public immutable escrowImplementation;

    constructor(address _escrowImplementation) {
        if (_escrowImplementation == address(0)) revert InvalidAddress();
        escrowImplementation = _escrowImplementation;
    }

    /**
     * @notice Creates escrow clone and locks funds using EIP-2612 permit + transferFrom.
     *
     * Flow:
     * 1) clone escrow
     * 2) initialize escrow
     * 3) permit(depositor -> Main, amount)
     * 4) transferFrom(depositor -> escrow, amount)  => lock
     * 5) escrow.onLocked()
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

        // Permit: approve Main to spend depositor's tokens (EIP-2612)
        IERC20Permit(token).permit(
            msg.sender,
            address(this),
            amount,
            deadline,
            v, r, s
        );

        // Lock funds in escrow
        IERC20(token).safeTransferFrom(msg.sender, escrow, amount);

        // Bookkeeping
        Escrow(escrow).confirmLock();

        emit EscrowCreated(escrow, msg.sender, beneficiary, token, amount);
    }

    /**
     * @notice Beneficiary completes work => escrow becomes Ready.
     */
    function completeWork(address escrow) external {
        Escrow e = Escrow(escrow);

        if (msg.sender != e.beneficiary()) {
            revert OnlyEscrowBeneficiary();
        }
        e.requestUnlock();
    }

    /**
     * @notice Depositor raises dispute within 7 days after completeWork (Ready set).
     *         This blocks withdraw.
     */
    function raiseDispute(address escrow) external {
        Escrow e = Escrow(escrow);

        if (msg.sender != e.depositor()) {
            revert OnlyEscrowDepositor();
        }

        // Must be within dispute window since completedAt
        uint256 completedAt = uint256(e.completedAt());
        uint256 window = uint256(e.DISPUTE_WINDOW());

        // If completeWork not called yet, completedAt==0; in that case you can revert or allow.
        // Here we require it to be Ready for dispute to make sense.
        require(e.state() == Escrow.State.Ready, "not ready");

        if (block.timestamp >= completedAt + window) {
            revert DisputeWindowPassed();
        }
        e.forceLock();
    }

    /**
     * @notice Beneficiary withdraws after dispute window passed and no dispute.
     *         Escrow enforces timing + disputed flag internally.
     */
    function withdrawEscrow(address escrow) external {
        Escrow e = Escrow(escrow);

        if (msg.sender != e.beneficiary()) {
            revert OnlyEscrowBeneficiary();
        }

        e.claim();
    }
}
