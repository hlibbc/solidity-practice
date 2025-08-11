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
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract TokenVesting is Ownable, ReentrancyGuard {
    // ---------------------------
    // Constants / Params
    // ---------------------------

    IERC20 public immutable usdt;
    uint8  public immutable usdtDecimals;
    uint256 public immutable BOX_PRICE_UNITS; // 350 * 10^decimals

    IERC20 public vestingToken;               // 베스팅 토큰(예: SPLA(18)), 나중에 set

    uint256 public immutable vestingStartDate; // 예: 2025-06-03 00:00:00 (UTC)
    uint256 public constant SECONDS_PER_DAY = 86400;
    uint256 public constant DAYS_PER_YEAR   = 365; // (참고 상수, 실 계산엔 termDays 사용)

    uint256 public constant BUYBACK_PCT = 10; // 10%
    bool    public floorTo6 = true;           // 18 → 소수점 6자리 절삭 지급

    // ---------------------------
    // Dynamic schedule state
    // ---------------------------

    /// @notice true가 되면 스케줄(연차 경계/총량) 초기화 완료
    bool public scheduleInitialized;

    /// @notice 연차별 종료시각 배열(절대 시각, inclusive), length = 연차 수
    uint256[] public poolEndTimes; // e.g., [end1, end2, end3, end4]

    /// @notice 연차별 구매자 총량 / 추천인 총량 (poolEndTimes와 같은 길이)
    uint256[] private buyerYearTotals;
    uint256[] private refYearTotals;

    /** @notice 연차 총량 업데이트 이벤트 */
    event YearTotalsUpdated(uint256 indexed year, uint256 buyerTotal, uint256 refTotal);

    // ---------------------------
    // Midnight tick state
    // ---------------------------

    /** @notice 다음에 확정할 자정(UTC 00:00) 타임스탬프 */
    uint256 public nextSyncTs;

    /** @notice 마지막으로 확정 처리한 "다음 대상 day 인덱스" */
    uint256 public lastSyncedDay;

    /** @notice 일별 동기화 완료 이벤트 */
    event DailySynced(uint256 indexed day, uint256 buyerPerBox, uint256 refPerUnit, uint256 boxesDenom, uint256 refDenom);

    // ---------------------------
    // Referral (8-char upper-alnum)
    // ---------------------------

    mapping(address => bytes8) public referralCodeOf;  // 주소 → 코드(8자)
    mapping(bytes8  => address) public codeToOwner;    // 코드 → 주소

    event ReferralCodeAssigned(address indexed user, bytes8 code);

    // ---------------------------
    // Daily accounting storage
    // ---------------------------

    mapping(uint256 => uint256) public boxesAddedPerDay;    // d → 오늘 추가 박스 수
    mapping(uint256 => uint256) public refUnitsAddedPerDay; // d → 오늘 추가 추천단위 수
    mapping(uint256 => uint256) public cumBoxes;            // d → 0..d 누적
    mapping(uint256 => uint256) public cumRefUnits;         // d → 0..d 누적
    mapping(uint256 => uint256) public rewardPerBox;        // d → per box (18)
    mapping(uint256 => uint256) public rewardPerRefUnit;    // d → per ref unit (18)
    mapping(uint256 => uint256) public cumRewardPerBox;     // d → 누적합
    mapping(uint256 => uint256) public cumRewardPerRefUnit; // d → 누적합

    // ---------------------------
    // User state (checkpoints)
    // ---------------------------

    struct BalanceCheckpoint {
        uint256 day;
        uint256 balance;
    }
    mapping(address => BalanceCheckpoint[]) public buyerBalanceHistory;
    mapping(address => BalanceCheckpoint[]) public refBalanceHistory;

    uint256 private constant UNSET = type(uint256).max;
    mapping(address => uint256) public lastBuyerClaimedDay;
    mapping(address => uint256) public lastRefClaimedDay;

    mapping(address => uint256) public buybackUSDT;

    // ---------------------------
    // Events (ops)
    // ---------------------------

    event BoxesPurchased(
        address indexed buyer,
        uint256 boxCount,
        address indexed referrer,
        uint256 usdtPaid,
        uint256 buyback,
        bytes8  refCode
    );
    event BuyerClaimed(address indexed user, uint256 amount, uint256 fromDay, uint256 toDay);
    event ReferrerClaimed(address indexed user, uint256 amount, uint256 fromDay, uint256 toDay);
    event BuybackClaimed(address indexed user, uint256 amount);
    event VestingTokenSet(address token);
    event FloorTo6Set(bool enabled);

    // ---------------------------
    // Constructor (no schedule init)
    // ---------------------------

    /**
     * @param _usdt 결제/바이백 스테이블코인 주소
     * @param _start 베스팅 시작 자정(UTC) — 예: 2025-06-03 00:00:00
     * @dev 스케줄(연차 경계/총량) 초기화는 반드시 별도 함수로 1회 수행해야 함.
     */
    constructor(address _usdt, uint256 _start) Ownable(msg.sender) {
        require(_usdt != address(0), "invalid USDT");
        usdt = IERC20(_usdt);
        usdtDecimals = IERC20Metadata(_usdt).decimals();
        BOX_PRICE_UNITS = 350 * (10 ** usdtDecimals);

        vestingStartDate = _start;

        // 스케줄은 initialize* 함수로 1회 설정
        scheduleInitialized = false;

        // 자정 틱 기준점만 먼저 세팅
        nextSyncTs = vestingStartDate;
        lastSyncedDay = 0;
    }

    // ---------------------------
    // Schedule initialization (one-shot)
    // ---------------------------

    /**
     * @notice 커스텀 스케줄을 1회 초기화(연차 경계/총량)
     * @param _poolEnds   연차별 종료시각(inclusive, epoch sec), strictly increasing & > start
     * @param _buyerTotals 연차별 구매자 총량(18dec)
     * @param _refTotals   연차별 추천인 총량(18dec)
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

        // 저장
        poolEndTimes = _poolEnds;
        buyerYearTotals = _buyerTotals;
        refYearTotals   = _refTotals;

        scheduleInitialized = true;
    }

    /// @notice 연차 수
    function yearCount() public view returns (uint256) { return poolEndTimes.length; }

    // ---------------------------
    // Admin: update totals (same constraints)
    // ---------------------------

    function setYearTotals(uint256 year, uint256 buyerTotal, uint256 refTotal) external onlyOwner {
        require(scheduleInitialized, "no schedule");
        require(year < yearCount(), "year oob");
        // 해당 연차 시작 전까지만 변경 가능
        require(nextSyncTs <= _yearStartTs(year), "year in progress");
        buyerYearTotals[year] = buyerTotal;
        refYearTotals[year]   = refTotal;
        emit YearTotalsUpdated(year, buyerTotal, refTotal);
    }

    function setYearTotalsBulk(uint256[] calldata _buyerTotals, uint256[] calldata _refTotals) external onlyOwner {
        require(scheduleInitialized, "no schedule");
        require(_buyerTotals.length == yearCount() && _refTotals.length == yearCount(), "len mismatch");
        // 스케줄 시작 전(= 아직 첫 날도 확정 전)
        require(nextSyncTs == vestingStartDate && lastSyncedDay == 0, "already started");
        for (uint256 y = 0; y < yearCount(); y++) {
            buyerYearTotals[y] = _buyerTotals[y];
            refYearTotals[y]   = _refTotals[y];
            emit YearTotalsUpdated(y, _buyerTotals[y], _refTotals[y]);
        }
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
        uint256 n = yearCount();
        for (uint256 i = 0; i < n; i++) {
            if (dayStartTs <= poolEndTimes[i]) return i;
        }
        return n; // beyond schedule
    }

    function _inYearIndex(uint256 dayStartTs, uint256 yearIdx) internal view returns (uint256) {
        uint256 yStart = _yearStartTs(yearIdx);
        // 0..(termDays-1)
        return (dayStartTs - yStart) / SECONDS_PER_DAY;
    }

    /**
     * @notice 자정 시각 기준 일일 풀 계산(마지막 날 보정 포함) — 연차별 실제 일수(termDays) 기반
     */
    function _dailyPoolRawByTs(uint256 dayStartTs, bool forBuyer) internal view returns (uint256) {
        if (!scheduleInitialized) return 0;
        uint256 y = _yearByTs(dayStartTs);
        if (y >= yearCount()) return 0;

        uint256 total = forBuyer ? buyerYearTotals[y] : refYearTotals[y];
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

    function sync() public {
        require(scheduleInitialized, "no schedule");
        uint256 nowTs = block.timestamp;
        while (nextSyncTs + SECONDS_PER_DAY <= nowTs) {
            uint256 dayStart = nextSyncTs;
            uint256 d = (dayStart - vestingStartDate) / SECONDS_PER_DAY;

            uint256 boxesDenom = d == 0 ? 0 : cumBoxes[d - 1];
            uint256 refDenom   = d == 0 ? 0 : cumRefUnits[d - 1];

            uint256 perBox = 0;
            uint256 perRef = 0;

            uint256 buyerPool = _dailyPoolRawByTs(dayStart, true);
            if (buyerPool > 0 && boxesDenom > 0) perBox = buyerPool / boxesDenom;

            uint256 refPool = _dailyPoolRawByTs(dayStart, false);
            if (refPool > 0 && refDenom > 0)   perRef = refPool / refDenom;

            rewardPerBox[d]        = perBox;
            rewardPerRefUnit[d]    = perRef;
            cumRewardPerBox[d]     = (d == 0 ? 0 : cumRewardPerBox[d - 1]) + perBox;
            cumRewardPerRefUnit[d] = (d == 0 ? 0 : cumRewardPerRefUnit[d - 1]) + perRef;

            uint256 prevBoxes = d == 0 ? 0 : cumBoxes[d - 1];
            uint256 prevRefs  = d == 0 ? 0 : cumRefUnits[d - 1];
            cumBoxes[d]    = prevBoxes + boxesAddedPerDay[d];
            cumRefUnits[d] = prevRefs  + refUnitsAddedPerDay[d];

            emit DailySynced(d, perBox, perRef, boxesDenom, refDenom);

            nextSyncTs += SECONDS_PER_DAY;
            lastSyncedDay = d + 1;
        }
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
    // Buy (permit / non-permit) — with referral string
    // ---------------------------

    struct PermitData {
        uint256 value;
        uint256 deadline;
        uint8   v;
        bytes32 r;
        bytes32 s;
    }

    function buyBox(uint256 boxCount, string calldata refCodeStr) external nonReentrant {
        _buy(boxCount, refCodeStr, false, PermitData(0,0,0,0,0));
    }

    function buyBoxWithPermit(uint256 boxCount, string calldata refCodeStr, PermitData calldata p) external nonReentrant {
        _buy(boxCount, refCodeStr, true, p);
    }

    function _buy(uint256 boxCount, string calldata refCodeStr, bool usePermit, PermitData memory p) internal {
        require(scheduleInitialized, "no schedule");
        require(block.timestamp >= vestingStartDate, "not started");
        require(boxCount > 0, "box=0");

        (address referrer, bytes8 normCode) = _referrerFromString(refCodeStr);
        require(referrer != msg.sender, "self referral");

        sync();

        uint256 cost = BOX_PRICE_UNITS * boxCount;
        if (usePermit) {
            IERC20Permit(address(usdt)).permit(
                msg.sender, address(this),
                p.value, p.deadline, p.v, p.r, p.s
            );
        }
        require(usdt.transferFrom(msg.sender, address(this), cost), "USDT xfer failed");

        uint256 buyback = (cost * BUYBACK_PCT) / 100;
        buybackUSDT[referrer] += buyback;

        uint256 dToday = (block.timestamp - vestingStartDate) / SECONDS_PER_DAY;
        boxesAddedPerDay[dToday] += boxCount;
        refUnitsAddedPerDay[dToday] += boxCount;

        _pushBuyerCheckpoint(msg.sender, dToday + 1, boxCount);
        _pushRefCheckpoint(referrer, dToday + 1, boxCount);

        _ensureReferralCode(msg.sender);

        emit BoxesPurchased(msg.sender, boxCount, referrer, cost, buyback, normCode);
    }

    // ---------------------------
    // Checkpoint helpers
    // ---------------------------

    function _pushBuyerCheckpoint(address user, uint256 effDay, uint256 added) internal {
        BalanceCheckpoint[] storage hist = buyerBalanceHistory[user];
        uint256 newBal = added;
        if (hist.length > 0) newBal += hist[hist.length - 1].balance;

        if (hist.length == 0 && lastBuyerClaimedDay[user] == 0) {
            lastBuyerClaimedDay[user] = UNSET;
        }
        hist.push(BalanceCheckpoint({ day: effDay, balance: newBal }));
    }

    function _pushRefCheckpoint(address user, uint256 effDay, uint256 added) internal {
        BalanceCheckpoint[] storage hist = refBalanceHistory[user];
        uint256 newBal = added;
        if (hist.length > 0) newBal += hist[hist.length - 1].balance;

        if (hist.length == 0 && lastRefClaimedDay[user] == 0) {
            lastRefClaimedDay[user] = UNSET;
        }
        hist.push(BalanceCheckpoint({ day: effDay, balance: newBal }));
    }

    // ---------------------------
    // Claim (vesting token / USDT buyback)
    // ---------------------------

    function setVestingToken(address _token) external onlyOwner {
        require(_token != address(0), "invalid token");
        vestingToken = IERC20(_token);
        emit VestingTokenSet(_token);
    }

    function setFloorTo6(bool on) external onlyOwner {
        floorTo6 = on; emit FloorTo6Set(on);
    }

    function claimBuyerReward() external nonReentrant {
        require(address(vestingToken) != address(0), "token not set");
        require(scheduleInitialized, "no schedule");
        sync();

        (uint256 fromDay, uint256 toDay) = _claimWindow(lastBuyerClaimedDay[msg.sender]);
        require(fromDay <= toDay, "nothing to claim");

        uint256 amount = _calcByHistory(buyerBalanceHistory[msg.sender], cumRewardPerBox, fromDay, toDay);
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

        uint256 amount = _calcByHistory(refBalanceHistory[msg.sender], cumRewardPerRefUnit, fromDay, toDay);
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
        require(usdt.transfer(msg.sender, amt), "USDT xfer failed");
        emit BuybackClaimed(msg.sender, amt);
    }

    // ---------------------------
    // View: claimable (finalized only) + referral views
    // ---------------------------

    function getBuyerClaimableReward(address user) external view returns (uint256) {
        (uint256 fromDay, uint256 toDay) = _viewClaimWindow(lastBuyerClaimedDay[user]);
        if (fromDay > toDay) return 0;
        return _calcByHistoryView(buyerBalanceHistory[user], cumRewardPerBox, fromDay, toDay);
    }

    function getReferrerClaimableReward(address user) external view returns (uint256) {
        (uint256 fromDay, uint256 toDay) = _viewClaimWindow(lastRefClaimedDay[user]);
        if (fromDay > toDay) return 0;
        return _calcByHistoryView(refBalanceHistory[user], cumRewardPerRefUnit, fromDay, toDay);
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
    // Admin backfill (CSV/과거 구매)
    // ---------------------------

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

        boxesAddedPerDay[d] += boxCount;
        _pushBuyerCheckpoint(buyer, d + 1, boxCount);

        if (referrer != address(0)) {
            refUnitsAddedPerDay[d] += boxCount;
            _pushRefCheckpoint(referrer, d + 1, boxCount);
            if (creditBuyback && usdtPaidUnits > 0) {
                buybackUSDT[referrer] += (usdtPaidUnits * BUYBACK_PCT) / 100;
            }
        }

        _ensureReferralCode(buyer);
        if (referrer != address(0)) _ensureReferralCode(referrer);
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

    function _previewBuyerClaimableAtTs(address user, uint256 ts) internal view returns (uint256) {
        (uint256 fromDay0, uint256 toDay0) = _viewClaimWindow(lastBuyerClaimedDay[user]);
        (uint256 previewLast,) = _previewLastFinalAt(ts);

        uint256 total = 0;
        if (fromDay0 <= toDay0) {
            total += _calcByHistoryView(buyerBalanceHistory[user], cumRewardPerBox, fromDay0, toDay0);
        }
        uint256 startSim = fromDay0 > lastSyncedDay ? fromDay0 : lastSyncedDay;
        if (startSim <= previewLast) {
            total += _previewBuyerPendingAt(user, startSim, previewLast);
        }
        return total;
    }

    function _previewReferrerClaimableAtTs(address user, uint256 ts) internal view returns (uint256) {
        (uint256 fromDay0, uint256 toDay0) = _viewClaimWindow(lastRefClaimedDay[user]);
        (uint256 previewLast,) = _previewLastFinalAt(ts);

        uint256 total = 0;
        if (fromDay0 <= toDay0) {
            total += _calcByHistoryView(refBalanceHistory[user], cumRewardPerRefUnit, fromDay0, toDay0);
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
        BalanceCheckpoint[] storage hist = buyerBalanceHistory[user];
        uint256 n = hist.length;

        uint256 i = 0; uint256 curBal = 0;
        while (i < n && hist[i].day <= startSim) { curBal = hist[i].balance; unchecked { i++; } }

        uint256 prevBoxes = (lastSyncedDay == 0) ? 0 : cumBoxes[lastSyncedDay - 1];
        if (startSim > lastSyncedDay) {
            for (uint256 dd = lastSyncedDay; dd < startSim; dd++) {
                prevBoxes += boxesAddedPerDay[dd];
            }
        }

        for (uint256 d = startSim; d <= endSim; d++) {
            while (i < n && hist[i].day <= d) { curBal = hist[i].balance; unchecked { i++; } }
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
        BalanceCheckpoint[] storage hist = refBalanceHistory[user];
        uint256 n = hist.length;

        uint256 i = 0; uint256 curBal = 0;
        while (i < n && hist[i].day <= startSim) { curBal = hist[i].balance; unchecked { i++; } }

        uint256 prevRefs = (lastSyncedDay == 0) ? 0 : cumRefUnits[lastSyncedDay - 1];
        if (startSim > lastSyncedDay) {
            for (uint256 dd = lastSyncedDay; dd < startSim; dd++) {
                prevRefs += refUnitsAddedPerDay[dd];
            }
        }

        for (uint256 d = startSim; d <= endSim; d++) {
            while (i < n && hist[i].day <= d) { curBal = hist[i].balance; unchecked { i++; } }
            uint256 denom = prevRefs;
            if (denom > 0 && curBal > 0) {
                uint256 dayStartTs = vestingStartDate + d * SECONDS_PER_DAY;
                uint256 pool = _dailyPoolRawByTs(dayStartTs, false);
                if (pool > 0) total += curBal * (pool / denom);
            }
            prevRefs += refUnitsAddedPerDay[d];
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

    function _viewClaimWindow(uint256 lastClaimed) internal view returns (uint256 fromDay, uint256 toDay) {
        if (lastSyncedDay == 0) return (1, 0);
        uint256 lastFinal = lastSyncedDay - 1;
        fromDay = (lastClaimed == UNSET) ? 0 : (lastClaimed + 1);
        toDay   = lastFinal;
    }

    function _calcByHistory(
        BalanceCheckpoint[] storage hist,
        mapping(uint256 => uint256) storage cumReward,
        uint256 fromDay,
        uint256 toDay
    ) internal view returns (uint256 total) {
        if (fromDay > toDay) return 0;
        uint256 n = hist.length;
        if (n == 0) return 0;

        uint256 i = 0;
        uint256 curBal = 0;
        while (i < n && hist[i].day <= fromDay) { curBal = hist[i].balance; unchecked { i++; } }

        uint256 segStart = fromDay;
        uint256 nextDay = (i < n) ? hist[i].day : (toDay + 1);
        uint256 segEnd   = nextDay > 0 ? _min(toDay, nextDay - 1) : toDay;

        if (segEnd >= segStart && curBal > 0) {
            total += curBal * _rangeSum(cumReward, segStart, segEnd);
        }

        while (i < n && hist[i].day <= toDay) {
            curBal  = hist[i].balance;
            segStart = hist[i].day;
            unchecked { i++; }
            nextDay = (i < n) ? hist[i].day : (toDay + 1);
            segEnd  = nextDay > 0 ? _min(toDay, nextDay - 1) : toDay;

            if (segEnd >= segStart && curBal > 0) {
                total += curBal * _rangeSum(cumReward, segStart, segEnd);
            }
        }
    }

    function _calcByHistoryView(
        BalanceCheckpoint[] storage hist,
        mapping(uint256 => uint256) storage cumReward,
        uint256 fromDay,
        uint256 toDay
    ) internal view returns (uint256) {
        return _calcByHistory(hist, cumReward, fromDay, toDay);
    }

    function _rangeSum(mapping(uint256 => uint256) storage cum, uint256 a, uint256 b) internal view returns (uint256 s) {
        if (a > b) return 0;
        if (a == 0) return cum[b];
        return cum[b] - cum[a - 1];
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    // ---------------------------
    // Utils
    // ---------------------------

    function _applyFloor6(uint256 amount18) internal view returns (uint256) {
        if (!floorTo6) return amount18;
        uint256 mod = 1e12; // 18 - 6
        return amount18 - (amount18 % mod);
    }

    // ---------------------------
    // Emergency
    // ---------------------------

    function emergencyWithdraw(address token, address to, uint256 amount) external onlyOwner {
        require(IERC20(token).transfer(to, amount), "withdraw failed");
    }

    // ---------------------------
    // Public views (totals)
    // ---------------------------

    function getYearTotals(uint256 year) external view returns (uint256 buyerTotal, uint256 refTotal) {
        require(scheduleInitialized, "no schedule");
        require(year < yearCount(), "year oob");
        return (buyerYearTotals[year], refYearTotals[year]);
    }

    function getAllYearTotals() external view returns (uint256[] memory buyerTotals, uint256[] memory refTotals) {
        require(scheduleInitialized, "no schedule");
        return (buyerYearTotals, refYearTotals);
    }
}
