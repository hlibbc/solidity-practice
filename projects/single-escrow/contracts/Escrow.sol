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
 *  - 'requestUnlock'호출 후 확정기간(finalizationDelay)이 지나면 수혜자(beneficiary)가 출금(claim) 가능
 *  - 'forceLock'이 발생하면 에스크로 상태는 'State.Locked'로 천이되며, 출금은 영구적으로 막힘.
 *  - 'resolve'호출을 통해 'State.Locked'을 해제할 수 있음.
 *
 * 상태 머신:
 *  1) initialize() -> state=Created
 *  2) Main이 토큰 전송 -> 컨트랙트 잔고가 amount가 됨
 *  3) confirmLock() -> 잔고 검증 + 이벤트 기록
 *  4) requestUnlock() -> state=Ready, completedAt 설정(확정기간 타임 마킹)
 *  5-a) 확정기간(finalizationDelay) 이내 forceLock() -> State.Locked
 *  5-b) 확정기간(finalizationDelay) 이후 forceLock() -> revert
 *  6) 확정기간(finalizationDelay) 이후 claim() -> beneficiary로 안전 전송 + State.Resolved로 천이
 *  7) State.Locked 상태에서는 resolve() 호출이 이루어져야 State.Resolved 상태로 천이가능
 *  8) State.Resolved 상태에서는 자유롭게 claim 할 수 있음
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
        Created, // 컨트랙트 생성 단계
        Confirmed, //  컨트랙트 입금 확인 단계
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
     * @notice 에스크로가 초기화되었을 때 1회 기록됩니다.
     * @dev
     *  - 트리거: `initialize(...)` 성공 시
     *
     * @param token 에스크로 대상 ERC20 토큰 주소
     * @param depositor 입금(락) 책임 주체 주소
     * @param beneficiary 최종 수령자 주소
     * @param amount 고정 락 금액 (initialize 시 확정)
     */
    event Initialized(
        address indexed token,
        address indexed depositor,
        address indexed beneficiary,
        uint256 amount
    );

    /**
     * @notice 입금이 실제로 확인(락 완료)되어 Confirmed 상태로 전환될 때 기록됩니다.
     * @dev
     *  - 트리거: `confirmLock()` 성공 시
     *
     * @param token 락된 토큰 주소
     * @param amount 에스크로 컨트랙트가 보유 중인 확정 락 금액
     */
    event EscrowConfirmed(
        address indexed token, 
        uint256 amount
    );
    /**
     * @notice 작업 완료 선언으로 Ready 상태로 전환될 때 기록됩니다.
     * @dev
     *  - 트리거: `requestUnlock()` 성공 시
     *
     * @param beneficiary 출금 대상 수혜자 주소
     * @param completedAt 완료 시각(UNIX epoch, seconds). 확정기간 계산 기준
     */
    event UnlockRequested(
        address indexed beneficiary, 
        uint64 completedAt
    );
    /**
     * @notice 강제 락업이 발동되어 Locked 상태로 전환될 때 기록됩니다.
     * @dev
     *  - 트리거: `forceLock()` 성공 시 (확정기간 이내에만 허용)
     *
     * @param depositor 강제 락을 요청한 주체(입금자)
     * @param forceLockedAt 강제 락업이 적용된 시각(UNIX epoch, seconds)
     */
    event EscrowLockForced(
        address indexed depositor, 
        uint64 forceLockedAt
    );
    /**
     * @notice 출금 정책(플랫폼 수수료, 순지급액, 분배 수 등)이 확정될 때 기록됩니다.
     * @dev
     *  - 트리거:
     *    - Ready → claim() 경로: 수혜자 단일 분배(alloc=1)
     *    - Locked → resolve(...) 경로: 다중 분배(alloc=n)
     *
     * @param escrowAddr 해당 에스크로 인스턴스 주소
     * @param token 대상 토큰 주소
     * @param grossAmount 총 락 금액
     * @param platformFee 플랫폼 수수료 (gross에서 차감)
     * @param netAmount 순지급 총액 (gross - fee)
     * @param allocationCount 분배 엔트리 개수
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
     * @notice 개별 수령자에 대한 분배 엔트리를 기록합니다.
     * @dev
     *  - 트리거:
     *    - claim() 경로: beneficiary 1건
     *    - resolve(...) 경로: recipients[i] 별로 n건
     *
     * @param escrowAddr 해당 에스크로 인스턴스 주소
     * @param token 대상 토큰 주소
     * @param recipient 분배 받을 주소
     * @param amount recipient에게 할당된 금액
     */
    event AllocationSet(
        address indexed escrowAddr,
        address indexed token,
        address indexed recipient,
        uint256 amount
    );
    /**
     * @notice 수령자가 실제로 금액을 수령(전송 완료)했을 때 기록됩니다.
     * @dev
     *  - 트리거:
     *    - Ready/Resolved 정책 확정 이후, `claim()`로 전송 성공 시
     *
     * @param escrowAddr 해당 에스크로 인스턴스 주소
     * @param token 전송된 토큰 주소
     * @param recipient 실 수령자 주소 (msg.sender)
     * @param amount 전송된 금액
     */
    event Claimed(
        address indexed escrowAddr,
        address indexed token,
        address indexed recipient,
        uint256 amount
    );

    /// Def. variable
    address public main;
    address public treasury;
    address public depositor;
    address public beneficiary;
    address public token; // e.g., USDC
    uint256 public amount; // locked amount
    uint64 public finalizationDelay; // 확정 유예기간, initialize에서 주입받는다.
    State public state;

    uint64 public completedAt; // timestamp when work completed

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
     * @param _main 메인 컨트랙트 주소
     * @param _treasury 트래져리 (플랫폼 fee 보관용) 컨트랙트 주소
     * @param _depositor 에스크로 입금자 주소
     * @param _beneficiary 에스크로 수령자 주소
     * @param _token 토큰 주소
     * @param _amount 에스크로 예치금액
     * @param _finalizationDelay 확정 유예기간
     * @dev Clone 패턴에서 constructor 대용으로 사용됩니다.
     *
     * 호출 주체:
     *  - 오직 `Main.createEscrow()` 흐름에서 1회 호출되는 것을 전제로 합니다.
     *
     * 검증:
     *  - 주소는 0이 아니어야 함
     *  - 금액은 0이 아니어야 함
     *  - 이미 초기화된 경우 재호출 불가
     * 고민사항
     * - _finalizationDelay의 상한을 둬야할지? (오류 혹은 악의적인 의도로 0xffff....ffff를 넣어버리면 resolve를 통해야만 claim 가능.. 이걸 허용할지?)
     */
    function initialize(
        address _main,
        address _treasury,
        address _depositor,
        address _beneficiary,
        address _token,
        uint256 _amount,
        uint64 _finalizationDelay
    ) external {
        if (_main == address(0) || _treasury == address(0) || _depositor == address(0) || _beneficiary == address(0) || _token == address(0)) {
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
        treasury = _treasury;
        depositor = _depositor;
        beneficiary = _beneficiary;
        token = _token;
        amount = _amount;
        finalizationDelay = _finalizationDelay;

        state = State.Created;

        emit Initialized(_token, _depositor, _beneficiary, _amount);
    }

    /**
     * @notice 토큰이 실제로 이 에스크로에 락 되었는지 검증하고 Confirmed 상태로 천이하며, 이벤트를 남깁니다.
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
        state = State.Confirmed;
        emit EscrowConfirmed(token, amount);
    }

    /**
     * @notice 작업 완료를 선언합니다(Ready 상태로 전환).
     * @dev 허용 조건: state == Confirmed
     */
    function requestUnlock() external onlyMain {
        if (state != State.Confirmed) {
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
        if (block.timestamp > uint256(completedAt) + uint256(finalizationDelay)) {
            revert FinalizeWindowExpired();
        }
        state = State.Locked;

        emit EscrowLockForced(depositor, uint64(block.timestamp));
    }

    /**
     * @notice 확정기간(finalizationDelay)가 끝났고, state가 State.Ready 상태이면 beneficiary로 송금합니다.
     * @dev 허용 조건(모두 만족):
     *  - state == Ready || state == Resolved
     *  - block.timestamp >= completedAt + finalizationDelay
     * 
     * 누구나 호출가능해야 함
     */
     function claim() external {
        State s = state; // 로컬캐시를 통한 SLOAD 최적화
        if (s != State.Ready && s != State.Resolved) {
            revert InvalidState();
        }

        if (block.timestamp < uint256(completedAt) + uint256(finalizationDelay)) {
            revert FinalizeWindowNotPassed();
        }

        address token_ = token; // 로컬캐시를 통한 SLOAD 최적화
        
        if (s == State.Ready) {
            uint256 gross = amount; // 에스크로에 묶인 총액
            uint256 platformFee = _queryPlatformFee(token_, gross); // 플랫폼 수수료
            uint256 net = gross - platformFee; // 실 수령금액

            if (platformFee > 0) {
                IERC20(token_).safeTransfer(treasury, platformFee);
            }
            claimableAmounts[beneficiary] = net;

            emit PayoutDefined(
                address(this),
                token_,
                gross,
                platformFee,
                net,
                1
            );

            emit AllocationSet(
                address(this),
                token_,
                beneficiary,
                net
            );

            state = State.Resolved;
            s = State.Resolved;
        }

        // s == Resolved
        uint256 claimable = claimableAmounts[msg.sender];
        if (claimable == 0) {
            return;
        }

        // CEI: effects first
        claimableAmounts[msg.sender] = 0;

        IERC20(token_).safeTransfer(msg.sender, claimable);

        emit Claimed(
            address(this),
            token_,
            msg.sender,
            claimable
        );
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
    function resolve(
        address[] calldata recipients, 
        uint256[] calldata amounts
    ) external onlyMain {
        if (state != State.Locked) {
            revert InvalidState();
        }

        uint256 n = recipients.length;
        if (n == 0 || n != amounts.length) {
            revert InvalidResolveArgs(n, amounts.length);
        }

        // 로컬캐시를 통한 SLOAD 최적화
        address token_ = token;
        uint256 gross = amount; // 에스크로에 묶인 금액 총액

        uint256 platformFee = _queryPlatformFee(token_, gross); // 플랫폼 수수료
        uint256 net = gross - platformFee; // 실수령액 총합

        if (platformFee > 0) {
            IERC20(token_).safeTransfer(treasury, platformFee);
        }

        emit PayoutDefined(
            address(this),
            token_,
            gross,
            platformFee,
            net,
            n
        );

        uint256 sum = 0;

        for (uint256 i = 0; i < n; ) {
            address r = recipients[i];
            uint256 a = amounts[i];

            if (r == address(0)) {
                revert InvalidAddress();
            }

            sum += a;

            // 중복 recipient는 누적 허용 (최적화)
            claimableAmounts[r] += a;

            emit AllocationSet(
                address(this),
                token_,
                r,
                a
            );

            unchecked { ++i; }
        }

        if (sum != net) {
            revert InvalidAmount();
        }

        state = State.Resolved;
    }

    /**
     * @notice 플랫폼 수수료를 쿼리합니다.
     * @param _token 토큰 주소
     * @param grossAmount 현재 에스크로에 묶인 총액
     * @return fee 플랫폼 수수료
     */
    function _queryPlatformFee(
        address _token, 
        uint256 grossAmount
    ) internal view returns (uint256 fee) {
        bytes memory data = abi.encodeWithSelector(
            IEscrowFeeResolver.escrowFee.selector,
            address(this),
            _token,
            grossAmount
        );

        (bool success, bytes memory ret) = main.staticcall(data);
        if (!success || ret.length != 32) {
            revert IEscrowFeeResolver.FeeQueryFailed();
        }

        fee = abi.decode(ret, (uint256));
        if (fee > grossAmount) {
            revert IEscrowFeeResolver.InvalidFee();
        }
    }
}
