// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./interface/IEscrowFeeResolver.sol";

/**
 * @title Escrow
 * @notice 단일 거래(1회성) ERC20 에스크로 인스턴스 컨트랙트
 * @dev
 *  `Main` 컨트랙트가 `clone`으로 배포하는 에스크로의 실제 로직(인스턴스)
 *  항상 `Main`을 통해서만 호출되도록 설계.
 *
 *  핵심 컨셉:
 *  - 금액(amount)은 고정(initialize 시점에 확정)이며, 이후 변경되지 않음.
 *  - 'Main`이 토큰을 이 컨트랙트로 전송한 후 confirmLock 호출  
 *  - 'requestUnlock'호출 후 확정기간(FINALIZATION_DELAY)이 지나면 수혜자(beneficiary)가 출금(claim) 가능
 *  - 'forceLock'이 발생하면 에스크로 상태는 'State.Locked'로 천이되며, 출금은 영구적으로 막힘.
 *  - 'resolve'호출을 통해 'State.Locked'을 해제할 수 있음.
 *
 * 상태 머신:
 *  1) initialize() -> state=Created
 *  2) Main이 토큰 전송 -> 컨트랙트 잔고가 amount가 됨
 *  3) confirmLock() -> 잔고 검증 + 이벤트 기록
 *  4) requestUnlock() -> state=Ready, completedAt 설정(확정기간 타임 마킹)
 *  5-a) 확정기간(FINALIZATION_DELAY) 이내 forceLock() -> State.Locked
 *  5-b) 확정기간(FINALIZATION_DELAY) 이후 forceLock() -> revert
 *  6) 확정기간(FINALIZATION_DELAY) 이후 claim() -> beneficiary로 안전 전송 + State.Withdrawned로 천이
 *
 */
contract Escrow {
    using SafeERC20 for IERC20;

    /// Def. enum
    /**
     * @notice 에스크로 컨트랙트의 상태를 정의합니다.
     */
    enum State {
        None, // 컨트랙트 생성 전 상태
        Created, // 컨트랙트 생성 및 입금 확인 단계
        Ready, // 출금 요청 상태
        Locked, // 강제 락업 상태
        Resolved, // 출금 정책 확정 상태
        Max
    }

    /// Def. error
    error AlreadyInitialized(); // 이미 초기화되었음
    error OnlyMain(); // Main 컨트랙트만 호출가능
    error InvalidAddress(); // 잘못된 주소값
    error InvalidAmount(); // 잘못된 금액
    error InvalidState(); // 잘못된 상태 (enum State)
    error FinalizeWindowNotPassed(); // 확정기간이 지나지 않았음
    error FinalizeWindowExpired(); // 확정기간이 이미 지났음
    /**
     * @notice resolve 함수 arguments 에러 정의: 
     * @dev
     *  - recipientNum: 수취자 주소 배열 크기
     *  - amountsNum: 수취자 금액 배열 크기
     */
    error InvalidResolveArgs(
        uint256 recipientNum, 
        uint256 amountsNum
    );

    /// Def. event
    /**
     * @notice 
     */
    event Initialized(
        address indexed token,
        address indexed depositor,
        address indexed beneficiary,
        uint256 amount
    );

    /**
     * @notice 
     */
    event EscrowConfirmed(
        address indexed token, 
        uint256 amount
    );
    /**
     * @notice 
     */
    event UnlockRequested(
        address indexed beneficiary, 
        uint64 completedAt
    );
    /**
     * @notice 
     */
    event EscrowLockForced(
        address indexed depositor, 
        uint64 forceLockedAt
    );
    /**
     * @notice 
     */
    event PayoutDefined(
        address indexed escrowAddr,
        address indexed token,
        uint256 grossAmount,
        uint256 platformFee,
        uint256 netAmount,
        uint256 allocationCount
    );
    /**
     * @notice 
     */
    event AllocationSet(
        address indexed escrowAddr,
        address indexed token,
        address indexed recipient,
        uint256 amount
    );
    /**
     * @notice 
     */
    event Claimed(
        address indexed escrowAddr,
        address indexed token,
        address indexed recipient,
        uint256 amount
    );

    /// Def. variable
    address public main;
    address public depositor;
    address public beneficiary;
    address public token; // e.g., USDC
    uint256 public amount; // locked amount
    State public state;

    uint64 public completedAt; // timestamp when work completed
    uint64 public constant FINALIZATION_DELAY = 7 days;

    mapping(address => uint256) public claimableAmounts;

    bool private initialized;

    /// Def. modifier
    modifier onlyMain() {
        if (msg.sender != main) {
            revert OnlyMain();
        }
        _;
    }

    /// Def. function
    /**
     * @notice 에스크로 인스턴스를 1회 초기화합니다.
     * @dev Clone 패턴에서 constructor 대용으로 사용됩니다.
     *
     * 호출 주체:
     *  - 오직 `Main.createEscrow()` 흐름에서 1회 호출되는 것을 전제로 합니다.
     *
     * 검증:
     *  - 주소는 0이 아니어야 함
     *  - 금액은 0이 아니어야 함
     *  - 이미 초기화된 경우 재호출 불가
     */
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
     * @notice 토큰이 실제로 이 에스크로에 락 되었는지 검증하고 이벤트를 남깁니다.
     * @dev 
     *  `Main`이 `transferFrom(depositor -> escrow, amount)`까지 끝낸 뒤 호출해야 합니다.
     *  Revert 조건:
     *   - state != Created
     *   - escrow 잔고 != amount
     */
    function confirmLock() external onlyMain {
        if (state != State.Created) {
            revert InvalidState();
        }
        if (IERC20(token).balanceOf(address(this)) != amount) {
            revert InvalidAmount();
        }
        emit EscrowConfirmed(token, amount);
    }

    /**
     * @notice 작업 완료를 선언합니다(Ready 상태로 전환).
     * @dev 허용 조건: state == Created
     */
    function requestUnlock() external onlyMain {
        if (state != State.Created) {
            revert InvalidState();
        }
        state = State.Ready;
        completedAt = uint64(block.timestamp);

        emit UnlockRequested(beneficiary, completedAt);
    }

    /**
     * @notice State.Locked로 강제 천이합니다. 이후 claim은 항상 revert 됩니다.
     * @dev 허용 조건: state == Ready
     */
    function forceLock() external onlyMain {
        if (state != State.Ready) {
            revert InvalidState();
        }
        if (block.timestamp > uint256(completedAt) + uint256(FINALIZATION_DELAY)) {
            revert FinalizeWindowExpired();
        }
        state = State.Locked;

        emit EscrowLockForced(depositor, uint64(block.timestamp));
    }

    /**
     * @notice 확정기간(FINALIZATION_DELAY)가 끝났고, state가 State.Ready 상태이면 beneficiary로 송금합니다.
     * @dev 허용 조건(모두 만족):
     *  - state == Ready
     *  - block.timestamp >= completedAt + FINALIZATION_DELAY
     * 
     * 누구나 호출가능해야 함
     */
    function claim() external {
        if (block.timestamp < uint256(completedAt) + uint256(FINALIZATION_DELAY)) {
            revert FinalizeWindowNotPassed();
        }
        if (state == State.Ready) {
            bytes memory data = abi.encodeWithSelector(
                IEscrowFeeResolver.getPlatformFee.selector,
                address(this),
                token,
                amount
            );

            (bool success, bytes memory ret) = main.staticcall(data);
            if (!success || ret.length != 32) {
                revert PlatformFeeQueryFailed();
            }

            uint256 platformFee = abi.decode(ret, (uint256));
            if (platformFee > amount) {
                revert InvalidPlatformFee();
            }
            claimableAmounts[beneficiary] = amount - platformFee;
            uint256 claimableAmount = claimableAmounts[beneficiary];
            emit PayoutDefined(
                address(this),
                token,
                amount,
                platformFee,
                claimableAmount,
                1
            );
            emit AllocationSet(
                address(this),
                token,
                beneficiary,
                claimableAmount
            );
            state = State.Resolved;
        }
        if (state == State.Resolved) {
            uint256 claimableAmount = claimableAmounts[address(msg.sender)];
            if (claimableAmount > 0) {
                IERC20(token).safeTransfer(address(msg.sender), claimableAmount);
                emit Claimed(
                    address(this),
                    token,
                    address(msg.sender),
                    claimableAmount
                );
                claimableAmounts[address(msg.sender)] = 0;
            }
        } else {
            revert InvalidState();
        }
    }

    /**
     * @notice forceLock이 발동되어 Locked된 자산을 해결합니다.
     * @param recipients 자산을 분배받을 주소들
     * @param amounts 분배받을 자산 금액
     * @dev 허용 조건(모두 만족):
     *  - onlyMain
     *  - state == Locked
     *  - recipients.length > 0
     *  - amount == sum(amounts) + platformFee
     *  - recipients.length == amounts.length
     */
    function resolve(address[] recipients, address[] amounts) external onlyMain {
        if (state != State.Locked) {
            revert InvalidState();
        }
        if (recipients.length == 0 || (recipients.length != amounts.length)) {
            revert InvalidResolveArgs(recipients.length, amounts.length);
        }
        bytes memory data = abi.encodeWithSelector(
            IEscrowFeeResolver.getPlatformFee.selector,
            address(this),
            token,
            amount
        );

        (bool success, bytes memory ret) = main.staticcall(data);
        if (!success || ret.length != 32) {
            revert PlatformFeeQueryFailed();
        }

        uint256 platformFee = abi.decode(ret, (uint256));
        if (platformFee > amount) {
            revert InvalidPlatformFee();
        }
        uint256 claimableAmount = amount - platformFee;
        emit PayoutDefined(
            address(this),
            token,
            amount,
            platformFee,
            claimableAmount,
            recipients.length
        );
        uint256 accumulatedAmount = 0;
        for (uint i = 0; i < recipients.length; i++) {
            accumulatedAmount += amounts[i];
            emit AllocationSet(
                address(this),
                token,
                recipients[i],
                amounts[i]
            );
            claimableAmounts[recipients[i]] = amounts[i];
        }
        if (accumulatedAmount + platformFee != amount) {
            revert InvalidAmount();
        }

        state = State.Resolved;
    }
}
