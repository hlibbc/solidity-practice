// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title TokenVesting (Timestamp-based midnight tick + Referral by 8-char code) — dynamic years
 * @notice
 *  - 매일 UTC 00:00에 전일 보상 확정(sync)
 *  - 연차 수/연차 경계/연차 총량을 동적 배열로 관리(초기화는 별도 1회 함수)
 *  - 구매는 USDT(EIP-2612 permit) 결제, 결제액 10% 추천인 USDT 바이백 적립
 *  - 레퍼럴: 대문자/숫자 8자리 코드 입력 필수(자기추천 금지), 신규 구매자에게 자동 코드 배정
 *  - 보상 계산은 확정 일별 단위보상의 누적합(prefix-sum) × 체크포인트
 */

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract TokenVesting is Ownable, ReentrancyGuard {

    using Math for uint256;

    // def. struct
    /**
     * @notice 날짜별 적용될, 박스 누적 보유수량 체크포인트
     * @dev
     * - day: 해당 날짜(포함)부터 효력
     * - amount: 박스 누적 보유수량(개수)
     */
    struct BoxAmountCheckpoint {
        uint256 day;
        uint256 amount;
    }

    /**
     * @notice EIP-2612 기반 permit 서명에 필요한 구조체 정보
     * @dev
     * - value: permit할 금액 (amount)
     * - deadline: 만료시각 (epoch)
     * - v/r/s: 서명 인자
     */
    struct PermitData {
        uint256 value;
        uint256 deadline;
        uint8   v;
        bytes32 r;
        bytes32 s;
    }
    
    // def. constant
    uint256 public constant SECONDS_PER_DAY = 86400; // 1일 (86400초)
    uint256 public constant BUYBACK_PERCENT = 10; // 10%

    // def. immutable
    IERC20  public immutable stableCoin; // 박스구매 재화 (스테이블코인)
    uint256 public immutable vestingStartDate; // 베스팅 시작시각

    // def. variable
    IERC20 public vestingToken; // 베스팅할 토큰
    uint256 private constant UNSET = type(uint256).max; // "클레임 이력없음" 표식을 위한 센티널 값

    /**
     * @notice 베스팅 스케줄 관리
     * @dev poolEndTimes, buyerPools, refYearTotals의 길이는 같아야 함
     */
    bool public scheduleInitialized; // 베스팅스케줄 초기화 완료 여부
    uint256[] public poolEndTimes; // 베스팅 차수별 종료시각
    uint256[] private buyerPools; // 차수별 구매자 풀 정보
    uint256[] private refererPools; // 차수별 레퍼러 풀 정보
    
    /**
     * @notice 동기화 관리
     * @dev 자정 (UTC00:00) 기준
     */
    uint256 public nextSyncTs; // 다음에 확정할 자정(UTC 00:00) 타임스탬프 
    uint256 public lastSyncedDay; // 베스팅 시작일 기준, 지금까지 확정(동기화) 완료한 일 수(0-base). 0이면 미확정
    
    /**
     * @notice vesting 계산을 위한 데이터 관리
     * @dev 일일 vesting 양 = 토큰풀 / 총 vesting 일수
     * 박스1개의 리워드 (rewardPerBox[d]) = 일일 vesting 양 * (구매수량(1) / 전체 판매수량(cumBoxes[d]))
     * cumBoxes[d] = cumBoxes[d-1] + boxesAddedPerDay[d]
     * cumRewardPerBox[d] = cumRewardPerBox[d-1] + rewardPerBox[d]
     * day (m) 에 구매한 박스의 day (n) 차 리워드
     * result = cumRewardPerBox[n] - cumRewardPerBox[m]
     */
    mapping(uint256 => uint256) public boxesAddedPerDay; // d → d일에 추가된 박스 수
    mapping(uint256 => uint256) public referralsAddedPerDay; // d → d일에 추가된 '레퍼럴'이 붙은 박스 수
    mapping(uint256 => uint256) public cumBoxes; // d → 0..d일까지의 누적 박스 수
    mapping(uint256 => uint256) public cumReferals; // d → 0..d일까지의 누적 '레퍼럴'이 붙은 박스 수
    mapping(uint256 => uint256) public rewardPerBox; // d → d일의 박스 1개당 일일 보상(18dec)
    mapping(uint256 => uint256) public rewardPerReferal; // d → d일의 '레퍼럴'이 붙은 박스 1개당 일일 보상(18dec)
    mapping(uint256 => uint256) public cumRewardPerBox; // d → 0..d일까지 1박스당 누적 보상 합(프리픽스 합)
    mapping(uint256 => uint256) public cumRewardPerRefUnit; // d → 0..d일까지 '레퍼럴' 1단위당 누적 보상 합

    /**
     * @notice user 정보 관리
     * @dev 유저 별 레퍼럴코드, 박스보유량 히스토리, 레퍼럴 추천양 히스토리 관리
     */
    mapping(address => bytes8) public referralCodeOf; // 주소 → 코드(8자)
    mapping(bytes8 => address) public codeToOwner; // 코드 → 주소
    mapping(address => BoxAmountCheckpoint[]) public buyerBoxAmountHistory; // 유저별 박스 보유량 체크포인트
    mapping(address => BoxAmountCheckpoint[]) public referralAmountHistory; // 유저별 레퍼럴 단위 보유량 체크포인트
    mapping(address => uint256) public lastBuyerClaimedDay; // 유저가 purchase pool에서 마지막으로 claim한 day index
    mapping(address => uint256) public lastRefClaimedDay; // 유저가 referral pool에서 마지막으로 claim한 day index
    mapping(address => uint256) public buybackUSDT; // 즉시 청구 가능한 USDT 바이백 잔액

    // def. event
    /** 
     * @notice 일별 정산(sync) 완료 이벤트
     * @dev
     * - day = (dayStartTs - vestingStartDate) / SECONDS_PER_DAY (0-베이스)
     * - 당일 추가분은 분모에 포함되지 않음(항상 전일까지의 누적치 기준).
     * - 보통 d==0에서는 분모가 0이므로 rewardPerBox/rewardPerRefUnit은 0.
     * - 단위:
     *   - rewardPerBox, rewardPerRefUnit: 18 decimals
     *   - boxesDenom, referralDenom: 개수(정수)
     * - sync() 루프 내에서 d일 확정 직후에 emit됨.
     *
     * rewardPerBox = dailyBuyerPool(d) / boxesDenom
     * rewardPerRefUnit = dailyRefPool(d) / referralDenom
     *
     * @param day 베스팅 시작일 기준 0-베이스 일 인덱스(이 날이 확정됨)
     * @param rewardPerBox Purchase 풀의 '박스 1개당' 일일 보상 단가(18dec)
     * @param rewardPerRefUnit Referral 풀의 '추천 단위 1개당' 일일 보상 단가(18dec)
     * @param boxesDenom 분모로 사용된 박스 수(전일까지 누적)
     * @param referralDenom 분모로 사용된 레퍼럴 수(전일까지 누적)
     */
    event DailySynced(
        uint256 indexed day, 
        uint256 rewardPerBox, 
        uint256 rewardPerRefUnit, 
        uint256 boxesDenom, 
        uint256 referralDenom
    );

    /**
     * @notice 유저에게 레퍼럴코드 부여 이벤트
     * @param user 유저 주소
     * @param code 레퍼럴코드
     */
    event ReferralCodeAssigned(
        address indexed user,
        bytes8 code
    );

    /**
     * @notice 박스 구매 이벤트
     * @dev
     * - buyBox 성공 시 emit (adminBackfillPurchaseAt도 동일 이벤트 emit)
     * - 당일 구매분은 다음 날부터 보상에 반영됨(effDay = dToday + 1)
     * - paidAmount / buyback 단위: stableCoin의 최소 단위(예: USDT 6dec)
     * - 자기추천 불가
     *
     * @param buyer 구매자 주소
     * @param boxCount 구매할 박스수량
     * @param referrer 추천인 주소
     * @param paidAmount 구매에 사용된 스테이블코인 금액(최소 단위)
     * @param buyback 추천인 적립 바이백 금액 (10%)
     * @param refCode 추천 코드(bytes8, 대문자 영문/숫자 8자, 정규화된 값)
     */
    event BoxesPurchased(
        address indexed buyer,
        uint256 boxCount,
        address indexed referrer,
        uint256 paidAmount,
        uint256 buyback,
        bytes8 refCode
    );

    /**
     * @notice 구매자 풀 기준 보상 클레임 완료 이벤트
     * @dev
     * - fromDay~toDay(둘 다 포함) 구간에 대해 확정된 보상만 지급됨.
     * - amount는 **항상** 18→6 자리 절삭 적용 후의 최종 지급액(vestingToken 단위).
     * - 내부 로직: amount = _calcByHistory(...) → pay = _applyFloor6(amount) → transfer(pay)
     *
     * @param user    클레임한 사용자 주소
     * @param amount  최종 지급액(vestingToken 단위; 18→6 자리 절삭 적용)
     * @param fromDay 청구 구간 시작 일 인덱스(포함)
     * @param toDay   청구 구간 종료 일 인덱스(포함; 일반적으로 lastSyncedDay-1)
     */
    event BuyerClaimed(
        address indexed user, 
        uint256 amount, 
        uint256 fromDay, 
        uint256 toDay
    );

    /**
     * @notice 추천인(Referral) 풀 기준 보상 클레임 완료 이벤트
     * @dev
     * - fromDay~toDay(둘 다 포함) 구간의 확정분만 지급.
     * - amount는 **항상** 18→6 자리 절삭 적용 후의 최종 지급액(vestingToken 단위).
     *
     * @param user    클레임한 추천인 주소
     * @param amount  최종 지급액(vestingToken 단위; 18→6 자리 절삭 적용)
     * @param fromDay 청구 구간 시작 일 인덱스(포함)
     * @param toDay   청구 구간 종료 일 인덱스(포함; 일반적으로 lastSyncedDay-1)
     */
    event ReferrerClaimed(
        address indexed user, 
        uint256 amount, 
        uint256 fromDay, 
        uint256 toDay
    );

    /**
     * @notice 추천 바이백(USDT) 청구 완료 이벤트
     * @dev
     * - buybackUSDT[user]에 누적된 전액을 출금하고 0으로 초기화.
     * - amount 단위는 stableCoin의 최소 단위(예: USDT 6dec).
     *
     * @param user   청구 사용자 주소
     * @param amount 지급된 USDT 금액(최소 단위)
     */
    event BuybackClaimed(
        address indexed user, 
        uint256 amount
    );

    /**
     * @notice 베스팅 지급 토큰 주소 설정 이벤트
     * @dev
     * - onlyOwner로 설정되며, 주소는 0이 될 수 없음.
     * - 설정 이후의 클레임에 사용됨(과거 기록에는 영향 없음).
     *
     * @param token 설정된 vestingToken 주소(ERC20)
     */
    event VestingTokenSet(address token);

    /**
     * @param _stableCoin 결제/바이백 스테이블코인 주소
     * @param _start 베스팅 시작 자정(UTC) — 예: 2025-06-03 00:00:00
     * @dev 스케줄(연차 경계/총량) 초기화는 반드시 별도 함수로 1회 수행해야 함.
     */
    constructor(address _stableCoin, uint256 _start) Ownable(msg.sender) {
        require(_stableCoin != address(0), "invalid USDT");
        stableCoin = IERC20(_stableCoin);

        vestingStartDate = _start;

        scheduleInitialized = false; // 스케줄은 initializeSchedule 함수로 1회 설정해야 함
        nextSyncTs = vestingStartDate; // 자정 틱 기준점만 먼저 세팅
        lastSyncedDay = 0;
    }

    /**
     * @notice 커스텀 스케줄을 1회 초기화(연차 경계/총량)
     * @param _poolEnds 연차별 종료시각(inclusive, epoch sec), strictly increasing & > start
     * @param _buyerTotals 연차별 구매자 총량(18dec)
     * @param _refTotals 연차별 추천인 총량(18dec)
     */
    function initializeSchedule(
        uint256[] calldata _poolEnds,
        uint256[] calldata _buyerTotals,
        uint256[] calldata _refTotals
    ) external onlyOwner {
        require(!scheduleInitialized, "schedule inited");
        require(_poolEnds.length > 0, "empty");
        require(_poolEnds.length == _buyerTotals.length && _poolEnds.length == _refTotals.length, "len mismatch");

        // strictly increasing & each > start
        uint256 prev = 0;
        for (uint256 i = 0; i < _poolEnds.length; i++) {
            uint256 e = _poolEnds[i];
            require(e > vestingStartDate, "end<=start");
            require(i == 0 ? true : e > prev, "not increasing");
            prev = e;
        }
        poolEndTimes = _poolEnds;
        buyerPools = _buyerTotals;
        refererPools = _refTotals;

        scheduleInitialized = true;
    }

    function setVestingToken(address _token) external onlyOwner {
        require(_token != address(0), "invalid token");
        vestingToken = IERC20(_token);
        emit VestingTokenSet(_token);
    }

    /**
     * @notice 과거 구매를 한 건 추가(백필)한다
     */
    function adminBackfillPurchaseAt(
        address buyer,
        address referrer,
        uint256 boxCount,
        uint256 purchaseTs,
        uint256 usdtPaidUnits,
        bool    creditBuyback
    ) external onlyOwner {
        require(scheduleInitialized, "no schedule");
        require(boxCount > 0, "box=0");

        uint256 d = (purchaseTs < vestingStartDate)
            ? 0
            : (purchaseTs - vestingStartDate) / SECONDS_PER_DAY;

        require(d >= lastSyncedDay, "day finalized");

        // 1) 스토리지 반영
        boxesAddedPerDay[d] += boxCount;
        _pushBuyerCheckpoint(buyer, d + 1, boxCount);

        uint256 buyback = 0;
        if (referrer != address(0)) {
            referralsAddedPerDay[d] += boxCount;
            _pushRefCheckpoint(referrer, d + 1, boxCount);

            if (creditBuyback && usdtPaidUnits > 0) {
                buyback = (usdtPaidUnits * BUYBACK_PERCENT) / 100;
                buybackUSDT[referrer] += buyback;
            }
        }

        // 2) 코드 보장(정규화된 코드 확보 후 이벤트에 넣음)
        _ensureReferralCode(buyer);
        if (referrer != address(0)) _ensureReferralCode(referrer);

        bytes8 refCode = (referrer != address(0)) ? referralCodeOf[referrer] : bytes8(0);

        // 3) 구매 이벤트 emit (스캐너 일원화)
        emit BoxesPurchased(buyer, boxCount, referrer, usdtPaidUnits, buyback, refCode);
    }

    /**
     * @notice 박스 구매 (EIP-2612 permit은 선택)
     * @dev
     * - p.deadline == 0 이면 permit 스킵 → 기존 approve 기반 결제
     * - p.deadline != 0 이면 permit 실행 후 결제
     */
    function buyBox(
        uint256 boxCount,
        string calldata refCodeStr,
        PermitData calldata p
    ) external nonReentrant {
        bool usePermit = (p.deadline != 0);
        _buy(boxCount, refCodeStr, usePermit, p);
    }

    function _buy(uint256 boxCount, string calldata refCodeStr, bool usePermit, PermitData memory p) internal {
        require(scheduleInitialized, "no schedule");
        require(block.timestamp >= vestingStartDate, "not started");
        require(boxCount > 0, "box=0");

        (address referrer, bytes8 normCode) = _referrerFromString(refCodeStr);
        require(referrer != msg.sender, "self referral");

        sync();

        uint256 cost = 0; // BOX_PRICE_UNITS * boxCount;
        if (usePermit) {
            IERC20Permit(address(stableCoin)).permit(
                msg.sender, address(this),
                p.value, p.deadline, p.v, p.r, p.s
            );
        }
        require(stableCoin.transferFrom(msg.sender, address(this), cost), "USDT xfer failed");

        uint256 buyback = (cost * BUYBACK_PERCENT) / 100;
        buybackUSDT[referrer] += buyback;

        uint256 dToday = (block.timestamp - vestingStartDate) / SECONDS_PER_DAY;
        boxesAddedPerDay[dToday]     += boxCount;
        referralsAddedPerDay[dToday] += boxCount;

        _pushBuyerCheckpoint(msg.sender, dToday + 1, boxCount);
        _pushRefCheckpoint(referrer, dToday + 1, boxCount);

        _ensureReferralCode(msg.sender);

        emit BoxesPurchased(msg.sender, boxCount, referrer, cost, buyback, normCode);
    }

    function sync() public {
        require(scheduleInitialized, "no schedule");
        uint256 nowTs = block.timestamp;
        while (nextSyncTs + SECONDS_PER_DAY <= nowTs) {
            _syncOneDay();
        }
    }

    function syncLimitDay(uint256 limitDays) external onlyOwner {
        require(scheduleInitialized, "no schedule");
        require(limitDays > 0, "limit=0");

        uint256 nowTs = block.timestamp;
        uint256 processed = 0;

        while (nextSyncTs + SECONDS_PER_DAY <= nowTs && processed < limitDays) {
            _syncOneDay();
            unchecked { ++processed; }
        }

        require(processed > 0, "nothing to sync");
    }

    function _syncOneDay() internal {
        uint256 dayStart = nextSyncTs;
        uint256 d = (dayStart - vestingStartDate) / SECONDS_PER_DAY;

        uint256 boxesDenom    = d == 0 ? 0 : cumBoxes[d - 1];
        uint256 referralDenom = d == 0 ? 0 : cumReferals[d - 1];

        uint256 perBox = 0;
        uint256 perRef = 0;

        uint256 buyerPool = _dailyPoolRawByTs(dayStart, true);
        if (buyerPool > 0 && boxesDenom > 0) {
            perBox = buyerPool / boxesDenom;
        }

        uint256 refPool = _dailyPoolRawByTs(dayStart, false);
        if (refPool > 0 && referralDenom > 0) {
            perRef = refPool / referralDenom;
        }

        rewardPerBox[d]        = perBox;
        rewardPerReferal[d]    = perRef;
        cumRewardPerBox[d]     = (d == 0 ? 0 : cumRewardPerBox[d - 1]) + perBox;
        cumRewardPerRefUnit[d] = (d == 0 ? 0 : cumRewardPerRefUnit[d - 1]) + perRef;

        uint256 prevBoxes = d == 0 ? 0 : cumBoxes[d - 1];
        uint256 prevRefs  = d == 0 ? 0 : cumReferals[d - 1];
        cumBoxes[d]       = prevBoxes + boxesAddedPerDay[d];
        cumReferals[d]    = prevRefs  + referralsAddedPerDay[d];

        emit DailySynced(d, perBox, perRef, boxesDenom, referralDenom);

        nextSyncTs += SECONDS_PER_DAY;
        lastSyncedDay = d + 1;
    }

    function claimBuyerReward() external nonReentrant {
        require(address(vestingToken) != address(0), "token not set");
        require(scheduleInitialized, "no schedule");
        sync();

        (uint256 fromDay, uint256 toDay) = _claimWindow(lastBuyerClaimedDay[msg.sender]);
        require(fromDay <= toDay, "nothing to claim");

        uint256 amount = _calcByHistory(buyerBoxAmountHistory[msg.sender], cumRewardPerBox, fromDay, toDay);
        require(amount > 0, "zero");

        lastBuyerClaimedDay[msg.sender] = toDay;

        uint256 pay = _applyFloor6(amount);
        require(vestingToken.transfer(msg.sender, pay), "xfer failed");

        emit BuyerClaimed(msg.sender, pay, fromDay, toDay);
    }

    function claimReferrerReward() external nonReentrant {
        require(address(vestingToken) != address(0), "token not set");
        require(scheduleInitialized, "no schedule");
        sync();

        (uint256 fromDay, uint256 toDay) = _claimWindow(lastRefClaimedDay[msg.sender]);
        require(fromDay <= toDay, "nothing to claim");

        uint256 amount = _calcByHistory(referralAmountHistory[msg.sender], cumRewardPerRefUnit, fromDay, toDay);
        require(amount > 0, "zero");

        lastRefClaimedDay[msg.sender] = toDay;

        uint256 pay = _applyFloor6(amount);
        require(vestingToken.transfer(msg.sender, pay), "xfer failed");

        emit ReferrerClaimed(msg.sender, pay, fromDay, toDay);
    }

    function claimBuyback() external nonReentrant {
        uint256 amt = buybackUSDT[msg.sender];
        require(amt > 0, "nothing");
        buybackUSDT[msg.sender] = 0;
        require(stableCoin.transfer(msg.sender, amt), "USDT xfer failed");
        emit BuybackClaimed(msg.sender, amt);
    }




    function getBuyerClaimableReward(address user) external view returns (uint256) {
        (uint256 fromDay, uint256 toDay) = _claimWindow(lastBuyerClaimedDay[user]);
        if (fromDay > toDay) return 0;
        return _calcByHistory(buyerBoxAmountHistory[user], cumRewardPerBox, fromDay, toDay);
    }

    function getReferrerClaimableReward(address user) external view returns (uint256) {
        (uint256 fromDay, uint256 toDay) = _claimWindow(lastRefClaimedDay[user]);
        if (fromDay > toDay) return 0;
        return _calcByHistory(referralAmountHistory[user], cumRewardPerRefUnit, fromDay, toDay);
    }

    function getBuybackBalance(address user) external view returns (uint256) {
        return buybackUSDT[user];
    }

    function myReferralCodeString(address user) external view returns (string memory) {
        bytes8 code = referralCodeOf[user];
        require(code != bytes8(0), "no code");
        return _bytes8ToString(code);
    }

    function ownerByReferralString(string calldata refCodeStr) external view returns (address) {
        (address referrer, ) = _referrerFromString(refCodeStr);
        return referrer;
    }

    // ---------------------------
    // NEW: View preview (pending days simulated)
    // ---------------------------

    function previewBuyerClaimable(address user) external view returns (uint256) {
        return _previewBuyerClaimableAtTs(user, block.timestamp);
    }

    function previewReferrerClaimable(address user) external view returns (uint256) {
        return _previewReferrerClaimableAtTs(user, block.timestamp);
    }

    function previewBuyerClaimableAt(address user, uint256 ts) external view returns (uint256) {
        return _previewBuyerClaimableAtTs(user, ts);
    }

    function previewReferrerClaimableAt(address user, uint256 ts) external view returns (uint256) {
        return _previewReferrerClaimableAtTs(user, ts);
    }



    // ---------------------------
    // Midnight tick helpers (dynamic)
    // ---------------------------

    function _yearStartTs(uint256 y) internal view returns (uint256) {
        if (y == 0) return vestingStartDate;
        return poolEndTimes[y - 1] + 1; // inclusive end 다음 초가 다음 연차 시작
    }

    function _yearEndTs(uint256 y) internal view returns (uint256) {
        return poolEndTimes[y]; // inclusive
    }

    /// @notice 해당 연차의 ‘일수’ (inclusive)
    function _termDays(uint256 y) internal view returns (uint256) {
        uint256 s = _yearStartTs(y);
        uint256 e = _yearEndTs(y);
        // e는 항상 s 이후이고, e가 inclusive이므로 +1
        return ((e - s) / SECONDS_PER_DAY) + 1;
    }

    function _yearByTs(uint256 dayStartTs) internal view returns (uint256) {
        uint256 n = poolEndTimes.length;
        for (uint256 i = 0; i < n; i++) {
            if (dayStartTs <= poolEndTimes[i]) return i;
        }
        return n; // beyond schedule
    }

    /**
     * @notice 자정 시각 기준 일일 풀 계산(마지막 날 보정 포함) — 연차별 실제 일수(termDays) 기반
     */
    function _dailyPoolRawByTs(uint256 dayStartTs, bool forBuyer) internal view returns (uint256) {
        if (!scheduleInitialized) return 0;
        uint256 y = _yearByTs(dayStartTs);
        if (y >= poolEndTimes.length) return 0;

        uint256 total = forBuyer ? buyerPools[y] : refererPools[y];
        if (total == 0) return 0;

        uint256 yStart = _yearStartTs(y);
        uint256 inYear = (dayStartTs - yStart) / SECONDS_PER_DAY; // 0..termDays-1
        uint256 termDays = _termDays(y);

        uint256 base = total / termDays;
        if (inYear == termDays - 1) {
            // 마지막 날 잔여 보정
            return total - base * (termDays - 1);
        }
        return base;
    }

    

    // ---------------------------
    // Referral helpers
    // ---------------------------

    function _normalizeToBytes8(string memory s) internal pure returns (bytes8 out) {
        bytes memory b = bytes(s);
        require(b.length == 8, "ref len!=8");
        uint64 acc = 0;
        for (uint256 i = 0; i < 8; i++) {
            uint8 c = uint8(b[i]);
            if (c >= 97 && c <= 122) c -= 32; // a-z -> A-Z
            bool isAZ = (c >= 65 && c <= 90);
            bool is09 = (c >= 48 && c <= 57);
            require(isAZ || is09, "ref invalid char");
            acc = (acc << 8) | uint64(c);
        }
        return bytes8(acc);
    }

    function _bytes8ToString(bytes8 code) internal pure returns (string memory) {
        bytes memory out = new bytes(8);
        uint64 v = uint64(code);
        for (uint256 i = 0; i < 8; i++) {
            out[7 - i] = bytes1(uint8(v & 0xFF));
            v >>= 8;
        }
        return string(out);
    }

    function _ensureReferralCode(address user) internal returns (bytes8 code) {
        code = referralCodeOf[user];
        if (code != bytes8(0)) return code;

        uint256 salt = 0;
        while (true) {
            bytes8 raw = bytes8(keccak256(abi.encodePacked(user, salt)));
            bytes memory buf = new bytes(8);
            for (uint256 i = 0; i < 8; i++) {
                uint8 x = uint8(uint64(uint64(bytes8(raw)) >> (i * 8)));
                uint8 m = x % 36;
                buf[7 - i] = bytes1(m < 26 ? (65 + m) : (48 + (m - 26)));
            }
            uint64 acc = 0;
            for (uint256 i = 0; i < 8; i++) {
                acc = (acc << 8) | uint64(uint8(buf[i]));
            }
            bytes8 cand = bytes8(acc);
            if (cand != bytes8(0) && codeToOwner[cand] == address(0)) {
                referralCodeOf[user] = cand;
                codeToOwner[cand] = user;
                emit ReferralCodeAssigned(user, cand);
                return cand;
            }
            unchecked { ++salt; }
        }
    }

    function _referrerFromString(string calldata refCodeStr) internal view returns (address referrer, bytes8 code) {
        code = _normalizeToBytes8(refCodeStr);
        referrer = codeToOwner[code];
        require(referrer != address(0), "ref code not found");
    }

    

    // ---------------------------
    // Checkpoint helpers
    // ---------------------------

    function _pushBuyerCheckpoint(address user, uint256 effDay, uint256 added) internal {
        BoxAmountCheckpoint[] storage hist = buyerBoxAmountHistory[user];
        uint256 newBal = added;
        if (hist.length > 0) newBal += hist[hist.length - 1].amount;

        if (hist.length == 0 && lastBuyerClaimedDay[user] == 0) {
            lastBuyerClaimedDay[user] = UNSET;
        }
        hist.push(BoxAmountCheckpoint({ day: effDay, amount: newBal }));
    }

    function _pushRefCheckpoint(address user, uint256 effDay, uint256 added) internal {
        BoxAmountCheckpoint[] storage hist = referralAmountHistory[user];
        uint256 newBal = added;
        if (hist.length > 0) newBal += hist[hist.length - 1].amount;

        if (hist.length == 0 && lastRefClaimedDay[user] == 0) {
            lastRefClaimedDay[user] = UNSET;
        }
        hist.push(BoxAmountCheckpoint({ day: effDay, amount: newBal }));
    }

    

    function _previewBuyerClaimableAtTs(address user, uint256 ts) internal view returns (uint256) {
        (uint256 fromDay0, uint256 toDay0) = _claimWindow(lastBuyerClaimedDay[user]);
        (uint256 previewLast,) = _previewLastFinalAt(ts);

        uint256 total = 0;
        if (fromDay0 <= toDay0) {
            total += _calcByHistory(buyerBoxAmountHistory[user], cumRewardPerBox, fromDay0, toDay0);
        }
        uint256 startSim = fromDay0 > lastSyncedDay ? fromDay0 : lastSyncedDay;
        if (startSim <= previewLast) {
            total += _previewBuyerPendingAt(user, startSim, previewLast);
        }
        return total;
    }

    function _previewReferrerClaimableAtTs(address user, uint256 ts) internal view returns (uint256) {
        (uint256 fromDay0, uint256 toDay0) = _claimWindow(lastRefClaimedDay[user]);
        (uint256 previewLast,) = _previewLastFinalAt(ts);

        uint256 total = 0;
        if (fromDay0 <= toDay0) {
            total += _calcByHistory(referralAmountHistory[user], cumRewardPerRefUnit, fromDay0, toDay0);
        }
        uint256 startSim = fromDay0 > lastSyncedDay ? fromDay0 : lastSyncedDay;
        if (startSim <= previewLast) {
            total += _previewRefPendingAt(user, startSim, previewLast);
        }
        return total;
    }

    function _previewLastFinalAt(uint256 ts) internal view returns (uint256 previewLastFinal, uint256 dNext) {
        uint256 tmpNext = nextSyncTs;
        uint256 d = lastSyncedDay;
        while (tmpNext + SECONDS_PER_DAY <= ts) {
            tmpNext += SECONDS_PER_DAY;
            unchecked { d++; }
        }
        previewLastFinal = (d == 0) ? 0 : (d - 1);
        dNext = d;
    }

    function _previewBuyerPendingAt(address user, uint256 startSim, uint256 endSim) internal view returns (uint256 total) {
        BoxAmountCheckpoint[] storage hist = buyerBoxAmountHistory[user];
        uint256 n = hist.length;

        uint256 i = 0; uint256 curBal = 0;
        while (i < n && hist[i].day <= startSim) { curBal = hist[i].amount; unchecked { i++; } }

        uint256 prevBoxes = (lastSyncedDay == 0) ? 0 : cumBoxes[lastSyncedDay - 1];
        if (startSim > lastSyncedDay) {
            for (uint256 dd = lastSyncedDay; dd < startSim; dd++) {
                prevBoxes += boxesAddedPerDay[dd];
            }
        }

        for (uint256 d = startSim; d <= endSim; d++) {
            while (i < n && hist[i].day <= d) { curBal = hist[i].amount; unchecked { i++; } }
            uint256 denom = prevBoxes;
            if (denom > 0 && curBal > 0) {
                uint256 dayStartTs = vestingStartDate + d * SECONDS_PER_DAY;
                uint256 pool = _dailyPoolRawByTs(dayStartTs, true);
                if (pool > 0) total += curBal * (pool / denom);
            }
            prevBoxes += boxesAddedPerDay[d];
        }
    }

    function _previewRefPendingAt(address user, uint256 startSim, uint256 endSim) internal view returns (uint256 total) {
        BoxAmountCheckpoint[] storage hist = referralAmountHistory[user];
        uint256 n = hist.length;

        uint256 i = 0; uint256 curBal = 0;
        while (i < n && hist[i].day <= startSim) { curBal = hist[i].amount; unchecked { i++; } }

        uint256 prevRefs = (lastSyncedDay == 0) ? 0 : cumReferals[lastSyncedDay - 1];
        if (startSim > lastSyncedDay) {
            for (uint256 dd = lastSyncedDay; dd < startSim; dd++) {
                prevRefs += referralsAddedPerDay[dd];
            }
        }

        for (uint256 d = startSim; d <= endSim; d++) {
            while (i < n && hist[i].day <= d) { curBal = hist[i].amount; unchecked { i++; } }
            uint256 denom = prevRefs;
            if (denom > 0 && curBal > 0) {
                uint256 dayStartTs = vestingStartDate + d * SECONDS_PER_DAY;
                uint256 pool = _dailyPoolRawByTs(dayStartTs, false);
                if (pool > 0) total += curBal * (pool / denom);
            }
            prevRefs += referralsAddedPerDay[d];
        }
    }

    // ---------------------------
    // Internals: claim window & math
    // ---------------------------

    function _claimWindow(uint256 lastClaimed) internal view returns (uint256 fromDay, uint256 toDay) {
        if (lastSyncedDay == 0) return (1, 0);
        uint256 lastFinal = lastSyncedDay - 1;
        fromDay = (lastClaimed == UNSET) ? 0 : (lastClaimed + 1);
        toDay   = lastFinal;
    }

    function _calcByHistory(
        BoxAmountCheckpoint[] storage hist,
        mapping(uint256 => uint256) storage cumReward,
        uint256 fromDay,
        uint256 toDay
    ) internal view returns (uint256 total) {
        if (fromDay > toDay) return 0;
        uint256 n = hist.length;
        if (n == 0) return 0;

        uint256 i = 0;
        uint256 curBal = 0;
        while (i < n && hist[i].day <= fromDay) { curBal = hist[i].amount; unchecked { i++; } }

        uint256 segStart = fromDay;
        uint256 nextDay = (i < n) ? hist[i].day : (toDay + 1);
        uint256 segEnd   = nextDay > 0 ? toDay.min(nextDay - 1) : toDay;

        if (segEnd >= segStart && curBal > 0) {
            total += curBal * _rangeSum(cumReward, segStart, segEnd);
        }

        while (i < n && hist[i].day <= toDay) {
            curBal  = hist[i].amount;
            segStart = hist[i].day;
            unchecked { i++; }
            nextDay = (i < n) ? hist[i].day : (toDay + 1);
            segEnd  = nextDay > 0 ? toDay.min(nextDay - 1) : toDay;

            if (segEnd >= segStart && curBal > 0) {
                total += curBal * _rangeSum(cumReward, segStart, segEnd);
            }
        }
    }

    function _rangeSum(mapping(uint256 => uint256) storage cum, uint256 a, uint256 b) internal view returns (uint256 s) {
        if (a > b) return 0;
        if (a == 0) return cum[b];
        return cum[b] - cum[a - 1];
    }

    /// @notice 18dec 금액을 소수 6자리로 절삭(항상 적용)
    function _applyFloor6(uint256 amount18) internal pure returns (uint256) {
        uint256 mod = 1e12; // 10^(18-6)
        return amount18 - (amount18 % mod);
    }
}
