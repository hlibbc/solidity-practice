// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract Escrow {
    using SafeERC20 for IERC20;

    enum State {
        None,
        Created,
        Ready,
        Locked,
        Withdrawned,
        Max
    }

    error AlreadyInitialized();
    error OnlyMain();
    error InvalidAddress();
    error InvalidAmount();
    error InvalidState();
    error DisputeWindowNotPassed();
    error Disputed();

    event Initialized(
        address indexed token,
        address indexed depositor,
        address indexed beneficiary,
        uint256 amount
    );

    event Locked(address indexed token, uint256 amount);
    event ReadySet(address indexed beneficiary, uint64 completedAt);
    event DisputedSet(address indexed depositor, uint64 disputedAt);
    event Withdrawn(address indexed token, address indexed beneficiary, uint256 amount);

    address public main;
    address public depositor;
    address public beneficiary;
    address public token; // e.g., USDC
    uint256 public amount; // locked amount
    State public state;

    uint64 public completedAt; // timestamp when work completed
    bool public disputed; // whether depositor raised a dispute

    uint64 public constant DISPUTE_WINDOW = 7 days;

    bool private initialized;

    modifier onlyMain() {
        if (msg.sender != main) revert OnlyMain();
        _;
    }

    function initialize(
        address _main,
        address _depositor,
        address _beneficiary,
        address _token,
        uint256 _amount
    ) external {
        if (_main == address(0) || _depositor == address(0) || _beneficiary == address(0) || _token == address(0)) {
            revert InvalidAddress();
        }
        if (_amount == 0) {
            revert InvalidAmount();
        }
        if (initialized) {
            revert AlreadyInitialized();
        }
        initialized = true;
        main = _main;
        depositor = _depositor;
        beneficiary = _beneficiary;
        token = _token;
        amount = _amount;

        state = State.Created;

        emit Initialized(_token, _depositor, _beneficiary, _amount);
    }

    /**
     * @dev Main calls after it has transferred `amount` tokens into this escrow.
     *      This is optional bookkeeping, but great for indexing/auditing.
     */
    function confirmLock() external onlyMain {
        if (state != State.Created) {
            revert InvalidState();
        }
        if (IERC20(token).balanceOf(address(this)) != amount) {
            revert InvalidAmount();
        }
        emit Locked(token, amount);
    }

    /**
     * @dev Main calls when beneficiary completed the work.
     *      Sets state to Ready and starts dispute window timer.
     */
    function requestUnlock() external onlyMain {
        if (state != State.Created) revert InvalidState();

        state = State.Ready;
        completedAt = uint64(block.timestamp);

        emit ReadySet(beneficiary, completedAt);
    }

    /**
     * @dev Main calls when depositor raises dispute during dispute window.
     *      Once disputed, withdrawal is blocked (revert).
     */
    function forceLock() external onlyMain {
        if (state != State.Ready) {
            revert InvalidState();
        }
        if (disputed) {
            revert Disputed();
        }
        disputed = true;

        emit DisputedSet(depositor, uint64(block.timestamp));
    }

    /**
     * @dev Main calls to withdraw locked funds to beneficiary.
     *      Allowed only if:
     *      - state == Ready
     *      - dispute window passed
     *      - disputed == false
     */
    function claim() external onlyMain {
        if (state != State.Ready) {
            revert InvalidState();
        }
        if (disputed) {
            revert Disputed();
        }
        if (block.timestamp < uint256(completedAt) + uint256(DISPUTE_WINDOW)) {
            revert DisputeWindowNotPassed();
        }

        state = State.Withdrawned;

        IERC20(token).safeTransfer(beneficiary, amount);

        emit Withdrawn(token, beneficiary, amount);
    }
}
