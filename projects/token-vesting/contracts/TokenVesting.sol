// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interface/IBadgeSBT.sol";

/**
 * @title TokenVesting - 동적 연차 기반 토큰 베스팅 시스템
 * @notice 
 *  - 매일 UTC 00:00에 전일 보상 확정(sync)
 *  - 연차 수/연차 경계/연차 총량을 동적 배열로 관리(초기화는 별도 1회 함수)
 *  - 구매는 StableCoin(EIP-2612 permit) 결제, 결제액 10% 추천인 StableCoin 바이백 적립
 *  - 레퍼럴: 대문자/숫자 8자리 코드 입력 필수(자기추천 금지), 신규 구매자에게 자동 코드 배정
 *  - 보상 계산은 확정 일별 단위보상의 누적합(prefix-sum) × 체크포인트
 * @dev 
 *  - 베스팅은 자정(UTC 00:00) 기준으로 일별 단위로 처리
 *  - 구매자 풀과 추천인 풀로 분리되어 각각 독립적으로 보상 계산
 *  - 체크포인트 기반으로 사용자별 보유량 변화를 추적
 */
contract TokenVesting is Ownable, ReentrancyGuard, ERC2771Context {

    using Math for uint256;
    using Address for address;

    /// def. error
    error InsufficientAfterPriorTransfers();
    error StableCoinTransferFailed();

    /// def. struct
    /**
     * @notice 날짜별 적용될, 박스 누적 보유수량 체크포인트
     * @notice 체크포인트는 사용자별로 시간순으로 저장되어 보상 계산 시 정확한 보유량 추적
     * @dev
     * - day: 해당 날짜(포함)부터 효력이 생기는 일 인덱스
     * - amount: 해당 시점까지의 누적 박스 보유수량(개수)
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
     * - v/r/s: ECDSA 서명의 구성 요소들
     */
    struct PermitData {
        uint256 value;
        uint256 deadline;
        uint8   v;
        bytes32 r;
        bytes32 s;
    }

    /**
     * @notice 과거 구매 백필을 위한 입력 파라미터
     * @dev
     * - buyer: 구매자
     * - refCodeStr: 추천인 레퍼럴 '문자열 코드' (빈 문자열이면 없음)
     * - boxCount: 구매한 박스 수량
     * - purchaseTs: 구매 시점 타임스탬프(초)
     * - paidUnits: 결제된 StableCoin 금액(최소단위)
     */
    struct BackfillPurchase {
        address buyer;
        string  refCodeStr;
        uint256 boxCount;
        uint256 purchaseTs;
        uint256 paidUnits;
    }

    /**
     * @notice 과거 시점 기준 박스 소유권 이전 백필 입력 파라미터
     * @dev
     * - from: 소유권 이전자
     * - from: 소유권 수령자
     * - from: 이전할 박스수량
     * - from: 소유권 이전 발생 시각(Unix ts). 실제 효력은 다음 날(effDay)부터.
     */
    struct BackfillSendBox {
        address from;
        address to;
        uint256 boxCount;
        uint256 transferTs;
    }
    
    /// def. constant
    uint256 public  constant BUYBACK_PERCENT = 10; // 추천인 바이백 비율 (10%)
    uint256 private constant SECONDS_PER_DAY = 86400; // 1일 (86400초) - UTC 자정 기준 계산용
    uint256 private constant MAX_BACKFILL_BULK = 10; // bulk 처리 10개
    uint256 private constant UNSET = type(uint256).max; // "클레임 이력없음" 표식을 위한 센티널 값
    IERC5484.BurnAuth private constant SBT_BURNAUTH = IERC5484.BurnAuth.Neither;

    /// def. immutable
    IERC20  public immutable stableCoin; // 박스구매 결제용 스테이블코인
    uint256 public immutable vestingStartDate; // 베스팅 시작 시각 (UTC 자정 기준)

    /// def. variable
    IERC20  public vestingToken; // 베스팅 지급용 토큰 (ERC20)
    address public recipient; // 구매된 스테이블코인 수령주소 (법인주소)

    /**
     * @notice 베스팅 스케줄 관리 - 연차별 풀 설정
     * @notice 각 연차마다 구매자 풀과 추천인 풀의 총량을 별도로 설정 가능
     * @dev poolEndTimes, buyerPools, refererPools의 길이는 반드시 같아야 함
     */
    bool public scheduleInitialized; // 베스팅스케줄 초기화 완료 여부 (1회만 설정 가능)
    uint256[] public poolEndTimes; // 베스팅 차수별 종료시각 (inclusive, epoch sec)
    uint256[] private buyerPools; // 차수별 구매자 풀 총량 (18 decimals)
    uint256[] private refererPools; // 차수별 추천인 풀 총량 (18 decimals)
    
    /**
     * @notice 동기화 관리 - 자정 기준 일별 보상 확정
     * @notice sync() 함수 호출 시 nextSyncTs부터 현재까지의 모든 완전한 하루를 처리
     * @dev 자정 (UTC 00:00) 기준으로 전일 보상을 확정하고 다음 동기화 시점을 계산
     */
    uint256 public nextSyncTs; // 다음에 확정할 자정(UTC 00:00) 타임스탬프 
    uint256 public lastSyncedDay; // 베스팅 시작일 기준, 지금까지 확정(동기화) 완료한 일 수(0-base). 0이면 미확정
    
    /**
     * @notice vesting 계산을 위한 핵심 데이터 관리 - 일별 누적 데이터
     * @notice prefix-sum 방식으로 효율적인 보상 계산 구현
     * @dev 
     * - 일일 vesting 양 = 토큰풀 / 총 vesting 일수
     * - 박스1개의 리워드 (rewardPerBox[d]) = 일일 vesting 양 * (구매수량(1) / 전체 판매수량(cumBoxes[d]))
     * - cumBoxes[d] = cumBoxes[d-1] + boxesAddedPerDay[d]
     * - cumRewardPerBox[d] = cumRewardPerBox[d-1] + rewardPerBox[d]
     * - day (m) 에 구매한 박스의 day (n) 차 리워드 = cumRewardPerBox[n] - cumRewardPerBox[m]
     */
    mapping(uint256 => uint256) public boxesAddedPerDay; // d → d일에 추가된 박스 수
    mapping(uint256 => uint256) public referralsAddedPerDay; // d → d일에 추가된 '레퍼럴'이 붙은 박스 수
    mapping(uint256 => uint256) public cumBoxes; // d → 0..d일까지의 누적 박스 수
    mapping(uint256 => uint256) public cumReferals; // d → 0..d일까지의 누적 '레퍼럴'이 붙은 박스 수
    mapping(uint256 => uint256) public rewardPerBox; // d → d일의 박스 1개당 일일 보상(18dec)
    mapping(uint256 => uint256) public rewardPerReferral; // d → d일의 '레퍼럴'이 붙은 박스 1개당 일일 보상(18dec)
    mapping(uint256 => uint256) public cumRewardPerBox; // d → 0..d일까지 1박스당 누적 보상 합(프리픽스 합)
    mapping(uint256 => uint256) public cumRewardPerReferral; // d → 0..d일까지 '레퍼럴' 1단위당 누적 보상 합

    /**
     * @notice 사용자 정보 관리 - 레퍼럴 코드, 보유량 히스토리, 클레임 상태
     * @dev 
     * - 유저별 레퍼럴코드, 박스보유량 히스토리, 레퍼럴 추천량 히스토리 관리
     * - 체크포인트 기반으로 시간별 보유량 변화 추적
     * - 클레임 상태는 각 풀별로 독립적으로 관리
     */
    mapping(address => bytes8) public referralCodeOf; // 주소 → 8자리 레퍼럴 코드
    mapping(bytes8 => address) public codeToOwner; // 8자리 코드 → 소유자 주소
    mapping(address => BoxAmountCheckpoint[]) public buyerBoxAmountHistory; // 유저별 박스 보유량 체크포인트 히스토리
    mapping(address => BoxAmountCheckpoint[]) public referralAmountHistory; // 유저별 레퍼럴 단위 보유량 체크포인트 히스토리
    mapping(address => uint256) public totalClaimedBuyer; // 유저별 purchase pool에서 클레임해간 베스팅토큰 양
    mapping(address => uint256) public totalClaimedReferral; // 유저별 referral pool에서 클레임해간 베스팅토큰 양
    mapping(address => uint256) public lastBuyerClaimedDay; // 유저가 purchase pool에서 마지막으로 claim한 day 인덱스
    mapping(address => uint256) public lastRefClaimedDay; // 유저가 referral pool에서 마지막으로 claim한 day 인덱스
    mapping(address => uint256) public buybackStableCoinAmount; // 즉시 청구 가능한 StableCoin 바이백 잔액 (10% 수수료)
    
    /**
     * @notice 박스 가격 관련 정보 관리
     * @dev 
     * - discount 레퍼럴 => discountRate 매핑
     */
    mapping (bytes8 => uint256) public refDiscountOf; // 레퍼럴코드 별 discount Rate 관리

    /**
     * @notice BadgeSBT 관련 정보
     * @dev
     * - badgeSBT: BadgeSBT 컨트랙트 주소 (SBT 토큰 민팅 및 업그레이드용)
     * - sbtIdOf: 사용자 주소 → 해당 사용자의 SBT 토큰 ID 매핑
     * - totalBoughtBoxes: 사용자 주소 → 누적 구매한 박스 수량 (등급 결정용)
     */
    IBadgeSBT public badgeSBT;
    mapping(address => uint256) public sbtIdOf; // user -> SBT tokenId
    mapping(address => uint256) public totalBoughtBoxes; // user -> 누적 구매량(박스 수)

    /// def. event
    /** 
     * @notice 일별 정산(sync) 완료 이벤트 - 베스팅 보상 확정
     * @param day 베스팅 시작일 기준 0-베이스 일 인덱스(이 날이 확정됨)
     * @param rewardPerBox Purchase 풀의 '박스 1개당' 일일 보상 단가(18dec)
     * @param rewardPerRefUnit Referral 풀의 '추천 단위 1개당' 일일 보상 단가(18dec)
     * @param boxesDenom 분모로 사용된 박스 수(당일까지 누적)
     * @param referralDenom 분모로 사용된 레퍼럴 수(당일까지 누적)
     * @dev
     * - day = (dayStartTs - vestingStartDate) / SECONDS_PER_DAY (0-베이스)
     * - 당일까지 누적(= 당일분 포함)
     * - 보통 d==0에서는 분모가 0이므로 rewardPerBox/rewardPerRefUnit은 0
     * - 단위:
     *   - rewardPerBox, rewardPerRefUnit: 18 decimals
     *   - boxesDenom, referralDenom: 개수(정수)
     * - sync() 루프 내에서 d일 확정 직후에 emit됨
     *
     * rewardPerBox = dailyBuyerPool(d) / boxesDenom
     * rewardPerRefUnit = dailyRefPool(d) / referralDenom
     */
    event DailySynced(
        uint256 indexed day, 
        uint256 rewardPerBox, 
        uint256 rewardPerRefUnit, 
        uint256 boxesDenom, 
        uint256 referralDenom
    );

    /**
     * @notice 유저에게 레퍼럴코드 부여 이벤트 - 자동 코드 생성
     * @param user 레퍼럴 코드가 할당된 유저 주소
     * @param code 할당된 8자리 레퍼럴 코드 (대문자 영문/숫자 조합)
     * @dev 신규 사용자 구매 시 자동으로 8자리 레퍼럴 코드가 생성되어 할당됨
     */
    event ReferralCodeAssigned(
        address indexed user,
        bytes8 code
    );

    /**
     * @notice 박스 구매 이벤트 - 구매 완료 및 레퍼럴 처리
     * @param buyer 구매자 주소
     * @param boxCount 구매할 박스수량
     * @param referrer 추천인 주소 (0x0이면 레퍼럴 없음)
     * @param paidAmount 구매에 사용된 스테이블코인 금액(최소 단위)
     * @param buyback 추천인 적립 바이백 금액 (10%)
     * @param refCode 추천 코드(bytes8, 대문자 영문/숫자 8자, 정규화된 값)
     * @param timestamp 발생 시각
     * @dev
     * - buyBox 성공 시 emit (adminBackfillPurchaseAt도 동일 이벤트 emit)
     * - 당일 구매분은 당일 분배에 참여, 익일 00:00 확정 (effDay = dToday)
     * - paidAmount / buyback 단위: stableCoin의 최소 단위(예: USDT, USDC의 경우 6dec)
     * - 자기추천 불가 (referrer != buyer 검증)
     * - 레퍼럴 코드는 정규화된 8자리 bytes8 형태로 저장
     */
    event BoxesPurchased(
        address indexed buyer,
        uint256 boxCount,
        address indexed referrer,
        uint256 paidAmount,
        uint256 buyback,
        bytes8 refCode,
        uint64 timestamp
    );

    /**
     * @notice 박스 소유권 이전 이벤트 - 내일부터 효력     
     * @param from 보낸 주소
     * @param to 받은 주소
     * @param boxCount 이전한 박스 수
     * @param timestamp 발생 시각
     * @dev 전송(send)/백필전송: “**다음 날(effDay=d+1)**부터 유효”
     */
    event BoxesTransferred(
        address indexed from,
        address indexed to,
        uint256 boxCount,
        uint64 timestamp
    );

    /**
     * @notice 구매자 풀 기준 보상 클레임 완료 이벤트 - 베스팅 토큰 지급
     * @param user 클레임한 사용자 주소
     * @param amount 최종 지급액(vestingToken 단위; 18→6 자리 절삭 적용)
     * @param fromDay 청구 구간 시작 일 인덱스(포함)
     * @param toDay 청구 구간 종료 일 인덱스(포함; 일반적으로 lastSyncedDay-1)
     * @dev
     * - fromDay~toDay(둘 다 포함) 구간에 대해 확정된 보상만 지급됨
     * - amount는 **항상** 18→6 자리 절삭 적용 후의 최종 지급액(vestingToken 단위)
     * - 내부 로직: amount = _calcByHistory(...) → pay = _applyFloor6(amount) → transfer(pay)
     * - 체크포인트 기반으로 정확한 보유량에 따른 보상 계산
     */
    event PurchasePoolClaimed(
        address indexed user, 
        uint256 amount, 
        uint256 fromDay, 
        uint256 toDay
    );

    /**
     * @notice 추천인(Referral) 풀 기준 보상 클레임 완료 이벤트 - 레퍼럴 보상 지급
     * @param user 클레임한 추천인 주소
     * @param amount 최종 지급액(vestingToken 단위; 18→6 자리 절삭 적용)
     * @param fromDay 청구 구간 시작 일 인덱스(포함)
     * @param toDay 청구 구간 종료 일 인덱스(포함; 일반적으로 lastSyncedDay-1)
     * @dev
     * - fromDay~toDay(둘 다 포함) 구간의 확정분만 지급
     * - amount는 **항상** 18→6 자리 절삭 적용 후의 최종 지급액(vestingToken 단위)
     * - 추천인은 자신이 추천한 박스 수량에 비례하여 보상 받음
     * - 구매자 풀과 독립적으로 계산 및 지급
     */
    event ReferralPoolClaimed(
        address indexed user, 
        uint256 amount, 
        uint256 fromDay, 
        uint256 toDay
    );

    /**
     * @notice 추천 바이백(StableCoin) 청구 완료 이벤트 - 수수료 환급
     * @param user 청구 사용자 주소
     * @param amount 지급된 StableCoin 금액(최소 단위)
     * @dev
     * - buybackStableCoinAmount[user]에 누적된 전액을 출금하고 0으로 초기화
     * - amount 단위는 stableCoin의 최소 단위(예: USDT, USDC 6dec)
     * - 추천인은 자신이 추천한 구매의 10%를 USDT로 즉시 수령 가능
     * - 바이백은 구매 시점에 즉시 적립되고 언제든지 청구 가능
     */
    event BuybackClaimed(
        address indexed user, 
        uint256 amount
    );

    /**
     * @notice 베스팅 지급 토큰 주소 설정 이벤트 - 토큰 설정
     * @dev
     * - onlyOwner로 설정되며, 주소는 0이 될 수 없음
     * - 설정 이후의 클레임에 사용됨(과거 기록에는 영향 없음)
     * - 베스팅 토큰은 스케줄 초기화 후 언제든지 설정 가능
     *
     * @param token 설정된 vestingToken 주소(ERC20)
     */
    event VestingTokenSet(address indexed token);


    /**
     * @notice BadgeSBT 컨트랙트 주소 설정 이벤트 - SBT 컨트랙트 변경
     * @param sbt 새로 설정된 BadgeSBT 컨트랙트 주소
     * @dev onlyOwner로 BadgeSBT 컨트랙트 주소를 변경할 때 발생
     */
    event BadgeSBTSet(address indexed sbt);

    /**
     * @notice Recipient 주소 설정 이벤트
     * @param newAddr 새로운 recipient 주소
     */
    event RecipientSet(address indexed newAddr);

    /**
     * @notice 레퍼럴 discount 설정 이벤트
     * @param addr 레퍼럴 소유자 주소
     * @param code 레퍼럴코드 (bytes8 치환값)
     * @param discount discount rate (0: discount 적용하지 않음)
     */
    event ReferralDiscountSet(
        address indexed addr, 
        bytes8 code, 
        uint256 discount
    );

    /**
     * @notice BadgeSBT 토큰 민팅 완료 이벤트 - 새로운 SBT 토큰 생성
     * @param user SBT 토큰을 받은 사용자 주소
     * @param tokenId 새로 민팅된 SBT 토큰의 ID
     * @dev 사용자가 첫 번째 박스를 구매할 때 자동으로 SBT 토큰이 민팅됨
     */
    event BadgeSBTMinted(
        address indexed user, 
        uint256 indexed tokenId
    );
    
    /**
     * @notice BadgeSBT 토큰 등급 업그레이드 이벤트 - 구매량 증가로 인한 등급 상승
     * @param user 등급이 업그레이드된 사용자 주소
     * @param tokenId 업그레이드된 SBT 토큰의 ID
     * @param tier 새로운 등급 (Bronze, Silver, Gold, Platinum 등)
     * @param totalBoxes 업그레이드 시점의 누적 구매 박스 수량
     * @dev 사용자가 박스를 추가로 구매하여 등급이 상승할 때 발생
     */
    event BadgeSBTUpgraded(
        address indexed user, 
        uint256 indexed tokenId, 
        IBadgeSBT.Tier tier, 
        uint256 totalBoxes
    );

    /**
     * @notice TokenVesting 컨트랙트 생성자
     * @param _forwarder 위임대납 forwarder 주소
     * @param _stableCoin 결제/바이백 스테이블코인 주소
     * @param _start 베스팅 시작 자정(UTC) — 예: 2025-06-03 00:00:00
     * @dev 
     * - 스케줄(연차 경계/총량) 초기화는 반드시 별도 함수로 1회 수행해야 함
     * - 베스팅 시작 시각은 UTC 자정 기준으로 설정되어야 함
     * - 생성 직후에는 스케줄이 초기화되지 않은 상태로 시작
     */
    constructor(
        address _forwarder, 
        address _stableCoin,
        uint256 _start
    ) Ownable(msg.sender) ERC2771Context(_forwarder) {
        require(_stableCoin != address(0), "invalid StableCoin");
        stableCoin = IERC20(_stableCoin);

        vestingStartDate = _start;

        scheduleInitialized = false; // 스케줄은 initializeSchedule 함수로 1회 설정해야 함
        nextSyncTs = vestingStartDate; // 자정 틱 기준점만 먼저 세팅
        lastSyncedDay = 0;
    }

    /**
     * @notice 커스텀 스케줄을 1회 초기화(연차 경계/총량) - 베스팅 설정
     * @dev 
     * - 이 함수는 컨트랙트 생성 후 반드시 1회만 호출되어야 함
     * - 연차별로 구매자 풀과 추천인 풀의 총량을 별도로 설정 가능
     * - 각 연차는 베스팅 시작일 이후의 시점이어야 하며, 엄격하게 증가해야 함
     * @param _poolEnds 연차별 종료시각(inclusive, epoch sec), strictly increasing & > start
     * @param _buyerTotals 연차별 구매자 풀 총량(18dec) - 해당 연차 동안 지급될 총 베스팅 토큰
     * @param _refTotals 연차별 추천인 풀 총량(18dec) - 해당 연차 동안 지급될 총 레퍼럴 보상
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

    /**
     * @notice 베스팅 지급 토큰 주소 설정 - 토큰 설정
     * @dev 
     * - onlyOwner만 호출 가능
     * - 베스팅 토큰은 스케줄 초기화 후 언제든지 설정 가능
     * - 설정된 토큰은 이후의 모든 클레임에 사용됨
     * @param _token 베스팅 지급용 ERC20 토큰 주소
     */
    function setVestingToken(address _token) external onlyOwner {
        require(_token != address(0), "invalid token");
        vestingToken = IERC20(_token);
        emit VestingTokenSet(_token);
    }

    /**
     * @notice BadgeSBT 컨트랙트 주소 설정 - SBT 컨트랙트 변경
     * @param _sbt 새로 설정할 BadgeSBT 컨트랙트 주소
     * @dev 
     * - onlyOwner만 호출 가능
     * - 기존 SBT 토큰들은 그대로 유지되며, 새로운 컨트랙트로 관리됨
     * - 설정 완료 시 BadgeSBTSet 이벤트 발생
     * - 주소는 0이 될 수 없음 (유효성 검증)
     */
    function setBadgeSBT(address _sbt) external onlyOwner {
        require(_sbt != address(0), "invalid sbt");
        badgeSBT = IBadgeSBT(_sbt);
        emit BadgeSBTSet(_sbt);
    }

    /**
     * @notice Recipient 주소 설정 함수
     * @param _newAddr 새로운 recipient 주소
     * @dev onlyOwner
     */
    function setRecipient(address _newAddr) external onlyOwner {
        require(_newAddr != address(0), "invalid address");
        recipient = _newAddr;
        emit RecipientSet(_newAddr);
    }

    /**
     * @notice 관리자가 여러 유저의 레퍼럴 코드를 일괄 설정하는 함수 (대량 이관용)
     * @param _users 레퍼럴 코드를 설정할 유저 주소 배열
     * @param _codes 설정할 레퍼럴 코드 문자열 배열 (각각 8자리)
     * @param _overwrite 기존 코드가 있을 때 덮어쓸지 여부
     * @dev 
     * - onlyOwner만 호출 가능
     * - _users와 _codes 배열의 길이가 일치해야 함
     * - 각 유저별로 개별적으로 내부 함수 호출하여 코드 설정
     * - 기존 시스템에서 대량의 레퍼럴 코드를 한 번에 이관할 때 사용
     */
    function setReferralCodesBulk(
        address[] calldata _users, 
        string[] calldata _codes, 
        bool _overwrite
    ) external onlyOwner {
        require(_users.length == _codes.length, "len mismatch");
        for (uint256 i = 0; i < _users.length; i++) {
            bytes8 code = _normalizeToBytes8(_codes[i]);
            _setReferralCodeInternal(_users[i], code, _overwrite);
        }
    }

    /**
     * @notice 레퍼럴 discount를 설정한다.
     * @param _refCodeStr 레퍼럴 문자열
     * @param _discountRate discount rate (0 ~ 100)
     * @dev onlyOwner
     */
    function setReferralDiscount(
        string calldata _refCodeStr, 
        uint256 _discountRate
    ) public onlyOwner {
        bytes8  code = _normalizeToBytes8(_refCodeStr);
        require(codeToOwner[code] != address(0), "Referral is not exist");
        require(_discountRate <= 100, "out of range");
        refDiscountOf[code] = _discountRate;
        emit ReferralDiscountSet(codeToOwner[code], code, _discountRate);
    }

    /**
     * @notice 과거 구매 백필 벌크 처리 (바이백 적립 없음)
     * @param _items BackfillPurchase 구조체
     * @dev
     * - onlyOwner
     * - _items 길이: 1..MAX_BACKFILL_BULK
     * - 각 원소는 backfillPurchaseAt(단건)과 동일 검증/처리
     * - 한 건이라도 실패 시 전체 revert (원자성 보장)
     */
    function backfillPurchaseBulkAt(
        BackfillPurchase[] calldata _items
    ) external onlyOwner {
        require(scheduleInitialized, "no schedule");
        uint256 n = _items.length;
        require(n > 0 && n <= MAX_BACKFILL_BULK, "invalid length");

        for (uint256 i = 0; i < n; ) {
            BackfillPurchase calldata p = _items[i];

            require(p.buyer != address(0), "zero buyer");
            require(p.boxCount > 0, "box=0");
            uint256 d = (p.purchaseTs < vestingStartDate)? 0 : (p.purchaseTs - vestingStartDate) / SECONDS_PER_DAY;
            require(d >= lastSyncedDay, "day finalized");
            
            // 0) 레퍼럴 문자열 → 주소/bytes8로 해석 (빈 문자열이면 없음)
            address referrer = address(0);
            bytes8  refCode  = bytes8(0);
            if (bytes(p.refCodeStr).length != 0) {
                (referrer, refCode) = _referrerFromString(p.refCodeStr); // 없으면 revert
            }

            // 1) 스토리지 반영 - 일별 데이터 업데이트
            boxesAddedPerDay[d] += p.boxCount;
            _pushBuyerCheckpoint(p.buyer, d, p.boxCount);

            if (referrer != address(0)) {
                referralsAddedPerDay[d] += p.boxCount;
                _pushRefCheckpoint(referrer, d, p.boxCount);
                // ⛔ 바이백 적립 없음
            }

            // 2) 코드 보장(존재 없으면 자동 생성) — 구매자/추천인 각각
            _ensureReferralCode(p.buyer);
            if (referrer != address(0)) {
                _ensureReferralCode(referrer);
            }

            // 3) 이벤트 emit (buyback=0 고정)
            emit BoxesPurchased(p.buyer, p.boxCount, referrer, p.paidUnits, 0, refCode, uint64(p.purchaseTs));

            totalBoughtBoxes[p.buyer] += p.boxCount;
            uint256 sbtId = _ensureSbt(p.buyer);
            _upgradeBadgeIfNeeded(p.buyer, sbtId);

            unchecked { ++i; }
        }
    }
    
    /**
     * @notice 과거 시점 기준 박스 소유권 이전 백필 벌크 처리
     * @param _items BackfillSendBox 구조체
     * @dev
     * - onlyOwner
     * - _items 길이: 1..MAX_BACKFILL_BULK
     * - 각 원소는 backfillSendBoxAt(단건)과 동일 검증/처리
     * - 한 건이라도 실패 시 전체 revert (원자성 보장)
     * - 구매/판매 기록(cumBoxes, boxesAddedPerDay, referralsAddedPerDay, totalBoughtBoxes 등) 변경 없음
     */
    function backfillSendBoxBulkAt(
        BackfillSendBox[] calldata _items
    ) external onlyOwner {
        require(scheduleInitialized, "no schedule");
        uint256 n = _items.length;
        require(n > 0 && n <= MAX_BACKFILL_BULK, "invalid length");

        for (uint256 i = 0; i < n; ) {
            BackfillSendBox calldata t = _items[i];

            require(t.from != address(0) && t.to != address(0), "zero");
            require(t.from != t.to, "same");
            require(t.boxCount > 0, "box=0");

            uint256 d = (t.transferTs < vestingStartDate)? 0 : (t.transferTs - vestingStartDate) / SECONDS_PER_DAY;

            // 확정된 날짜 이전으로는 백필 불가
            require(d >= lastSyncedDay, "day finalized");

            uint256 effDay = d; // 요청반영: 소유권이전 시 당일부터 효력발생

            // ── from(보낸 사람) 절대값 누적 차감(in-place)
            BoxAmountCheckpoint[] storage sHist = buyerBoxAmountHistory[t.from];

            // base: (같은 effDay 마지막 CP가 있으면 그 amount, 없으면 '해당 d 기준 보유량')
            uint256 base = _balanceAtDay(buyerBoxAmountHistory[t.from], d);
            if (sHist.length != 0 && sHist[sHist.length - 1].day == effDay) {
                base = sHist[sHist.length - 1].amount;
            }
            if (base < t.boxCount) {
                revert InsufficientAfterPriorTransfers();
            }

            uint256 newFromBal = base - t.boxCount;

            // 최초 이전 시 lastBuyerClaimedDay 초기화(필요 시)
            if (sHist.length == 0 && lastBuyerClaimedDay[t.from] == 0) {
                lastBuyerClaimedDay[t.from] = UNSET;
            }

            // 같은 effDay가 있으면 in-place 수정, 없으면 CP 추가
            if (sHist.length != 0 && sHist[sHist.length - 1].day == effDay) {
                sHist[sHist.length - 1].amount = newFromBal;
            } else {
                sHist.push(BoxAmountCheckpoint({ day: effDay, amount: newFromBal }));
            }

            // ── to(받는 사람) 누적 증가(구매와 동일 가산 로직)
            _pushBuyerCheckpoint(t.to, effDay, t.boxCount);

            // 수령자 레퍼럴 코드 보장(선택)
            _ensureReferralCode(t.to);

            uint256 sbtIdTo = _ensureSbt(t.to);
            _upgradeBadgeIfNeeded(t.to, sbtIdTo);

            emit BoxesTransferred(t.from, t.to, t.boxCount, uint64(t.transferTs));

            unchecked { ++i; }
        }
    }

    /**
     * @notice 박스 구매 (EIP-2612 permit은 선택) - 사용자 구매
     * @param _boxCount 구매할 박스 수량
     * @param _refCodeStr 8자리 레퍼럴 코드 문자열
     * @param _p EIP-2612 permit 데이터 (deadline이 0이면 스킵)
     * @dev
     * - p.deadline == 0 이면 permit 스킵 → 기존 approve 기반 결제
     * - p.deadline != 0 이면 permit 실행 후 결제
     * - nonReentrant로 재진입 공격 방지
     * APP에서 호출됨
     */
    function buyBox(
        uint256 _boxCount,
        string calldata _refCodeStr,
        PermitData calldata _p
    ) external nonReentrant {
        bool usePermit = (_p.deadline != 0);
        _buy(_boxCount, _refCodeStr, usePermit, _p);
    }

    /**
     * @notice 박스 소유권 이전(내일부터 효력) - 구매 기록/분모에는 영향 없음
     * @param _to 수령자
     * @param _boxCount 이전 수량
     * @dev 
     * - 오늘 보유량에서 boxCount를 차감하여 내일부터 효력 발생(effDay = today + 1)
     * - 수령자 보유량은 내일부터 _boxCount 증가
     * - boxesAddedPerDay / cumBoxes(판매량), referralsAddedPerDay 등 '판매/추천 기록'은 변경하지 않음
     * - totalBoughtBoxes, SBT 등은 '구매' 기준이므로 변경하지 않음
     */
    function sendBox(
        address _to, 
        uint256 _boxCount
    ) external nonReentrant onlyOwner {
        require(scheduleInitialized, "no schedule");
        require(block.timestamp >= vestingStartDate, "not started");

        address sender = _msgSender();

        require(_to != address(0), "zero to");
        require(_to != sender, "self");
        require(_boxCount > 0, "box=0");

        uint256 dToday = (block.timestamp - vestingStartDate) / SECONDS_PER_DAY;
        uint256 effDay = dToday; //  요청반영: 소유권이전 시 당일부터 효력발생

        // ── from(보낸 사람) 절대값 누적 차감(in-place)
        BoxAmountCheckpoint[] storage sHist = buyerBoxAmountHistory[sender];
        // base: (같은 effDay 마지막 CP가 있으면 그 amount, 없으면 '오늘 기준 보유량')
        uint256 base = _balanceAtDay(buyerBoxAmountHistory[sender], dToday);
        if (sHist.length != 0 && sHist[sHist.length - 1].day == effDay) {
            base = sHist[sHist.length - 1].amount;
        }
        if (base < _boxCount) {
            revert InsufficientAfterPriorTransfers();
        }

        uint256 newFromBal = base - _boxCount;
        if (sHist.length == 0 && lastBuyerClaimedDay[sender] == 0) {
            lastBuyerClaimedDay[sender] = UNSET;
        }
        if (sHist.length != 0 && sHist[sHist.length - 1].day == effDay) {
            // 같은 effDay면 마지막 체크포인트를 in-place 수정
            sHist[sHist.length - 1].amount = newFromBal;
        } else {
            // 새 effDay면 절대값 체크포인트 추가
            sHist.push(BoxAmountCheckpoint({ day: effDay, amount: newFromBal }));
        }
        // ── to(받는 사람) 누적 증가(구매와 동일 가산 로직)
        _pushBuyerCheckpoint(_to, effDay, _boxCount);
        // 수령자 레퍼럴 코드 보장(선택)
        _ensureReferralCode(_to);

        uint256 sbtIdTo = _ensureSbt(_to);
        _upgradeBadgeIfNeeded(_to, sbtIdTo);

        emit BoxesTransferred(sender, _to, _boxCount, (uint64)(block.timestamp));
    }

    /**
     * @notice 구매자 풀 보상 클레임 - 베스팅 토큰 수령
     * @notice 구매한 박스 수량에 비례하여 베스팅 토큰을 수령
     * @dev 
     * - nonReentrant로 재진입 공격 방지
     * - 클레임 전 sync() 호출로 최신 보상 확정
     * - 체크포인트 기반으로 정확한 보유량에 따른 보상 계산
     * - 18→6 자리 절삭 적용 후 최종 지급
     * APP에서 호출됨
     */
    function claimPurchaseReward() external nonReentrant {
        require(address(vestingToken) != address(0), "token not set");
        require(scheduleInitialized, "no schedule");
        sync();

        address sender = _msgSender();

        (uint256 fromDay, uint256 toDay) = _claimWindow(lastBuyerClaimedDay[sender]);
        require(fromDay <= toDay, "nothing to claim");

        uint256 amount = _calcByHistory(buyerBoxAmountHistory[sender], cumRewardPerBox, fromDay, toDay);
        require(amount > 0, "zero");

        lastBuyerClaimedDay[sender] = toDay;

        uint256 pay = _applyFloor6(amount);
        require(vestingToken.transfer(sender, pay), "xfer failed");
        totalClaimedBuyer[sender] += pay;

        emit PurchasePoolClaimed(sender, pay, fromDay, toDay);
    }

    /**
     * @notice 추천인 풀 보상 클레임 - 레퍼럴 보상 수령
     * @dev 
     * - nonReentrant로 재진입 공격 방지
     * - 클레임 전 sync() 호출로 최신 보상 확정
     * - 체크포인트 기반으로 정확한 추천량에 따른 보상 계산
     * - 18→6 자리 절삭 적용 후 최종 지급
     * APP에서 호출됨
     */
    function claimReferralReward() external nonReentrant {
        require(address(vestingToken) != address(0), "token not set");
        require(scheduleInitialized, "no schedule");
        sync();

        address sender = _msgSender();

        (uint256 fromDay, uint256 toDay) = _claimWindow(lastRefClaimedDay[sender]);
        require(fromDay <= toDay, "nothing to claim");

        uint256 amount = _calcByHistory(referralAmountHistory[sender], cumRewardPerReferral, fromDay, toDay);
        require(amount > 0, "zero");

        lastRefClaimedDay[sender] = toDay;

        uint256 pay = _applyFloor6(amount);
        require(vestingToken.transfer(sender, pay), "xfer failed");
        totalClaimedReferral[sender] += pay;

        emit ReferralPoolClaimed(sender, pay, fromDay, toDay);
    }

    /**
     * @notice 추천 바이백(StableCoin) 청구 - 수수료 환급
     * @dev 
     * - nonReentrant로 재진입 공격 방지
     * - 누적된 바이백 전액을 출금하고 0으로 초기화
     * - USDT를 사용자에게 직접 전송
     * APP에서 호출됨
     */
    function claimBuyback() external nonReentrant {
        address sender = _msgSender();

        uint256 amount = buybackStableCoinAmount[sender];
        require(amount > 0, "nothing");
        buybackStableCoinAmount[sender] = 0;
        if(!stableCoin.transfer(sender, amount)) {
            revert StableCoinTransferFailed();
        }
        emit BuybackClaimed(sender, amount);
    }

    /**
     * @notice 베스팅 보상 동기화 - 자정 기준 일별 보상 확정
     * @dev 
     * - nextSyncTs부터 현재까지의 모든 완전한 하루를 처리
     * - 각 하루마다 구매자 풀과 추천인 풀의 보상을 계산하고 확정
     * - 누적 데이터(cumBoxes, cumRewardPerBox 등) 업데이트
     * - 누구나 호출 가능하지만 가스비 발생
     * 외부에서 주기적으로 호출해야 함 (ex. 1주일에 1회)
     */
    function sync() public {
        require(scheduleInitialized, "no schedule");
        uint256 nowTs = block.timestamp;
        while (nextSyncTs + SECONDS_PER_DAY <= nowTs) {
            _syncOneDay();
        }
    }

    /**
     * @notice 베스팅 보상 동기화 (제한된 일수) - 관리자 전용
     * @param _limitDays 한 번에 처리할 최대 일수
     * @dev 
     * - onlyOwner만 호출 가능
     * - 가스 한도 문제로 인한 sync 실패를 방지하기 위한 제한 동기화
     * - limitDays만큼만 처리하여 가스 소모 제한
     * sync를 너무 오래 호출하지 않았을 경우, 나눠 호출하기 위한 용도 (리얼환경에서 호출X)
     */
    function syncLimitDay(uint256 _limitDays) external onlyOwner {
        require(scheduleInitialized, "no schedule");
        require(_limitDays > 0, "limit=0");

        uint256 nowTs = block.timestamp;
        uint256 processed = 0;

        while (nextSyncTs + SECONDS_PER_DAY <= nowTs && processed < _limitDays) {
            _syncOneDay();
            unchecked { ++processed; }
        }

        require(processed > 0, "nothing to sync");
    }

    /**
     * @notice (강제) 컨트랙트가 보유 중인 StableCoin 전액을 지정한 주소로 송금합니다.
     * @param _to 보낼 주소
     * @dev 
     *  - buybackStableCoinAmount에 적립된 금액(사용자 청구분)까지 함께 빠져나가므로
     *    운영 상 주의가 필요합니다. 오프체인 정산 전용/비상용으로만 사용하십시오.
     */
    function withdrawStableCoinForced(address _to) external onlyOwner nonReentrant {
        require(_to != address(0), "invalid to");
        require(scheduleInitialized, "no schedule");

        // 스케줄 상 마지막 종료시각( inclusive )을 '지난' 이후에만 허용
        uint256 lastEnd = poolEndTimes[poolEndTimes.length - 1] + 90 days; // hlibbc: 정책적용
        require(block.timestamp > lastEnd, "not withdraw yet");

        uint256 bal = stableCoin.balanceOf(address(this));
        require(bal > 0, "nothing to withdraw");

        if(!stableCoin.transfer(_to, bal)) {
            revert StableCoinTransferFailed();
        }
    }

    /**
     * @notice user가 보유한 박스수량을 반환한다.
     * @param _user user 주소
     * @return user가 보유한 박스수량
     * @dev APP에서 호출됨
     */
    function boxesOf(address _user) external view returns (uint256) {
        BoxAmountCheckpoint[] storage hist = buyerBoxAmountHistory[_user];
        return hist.length == 0 ? 0 : hist[hist.length - 1].amount;
    }

    /**
     * @notice 특정 날짜 기준 사용자의 구매 박스 보유량 조회
     * @param _user 조회할 사용자 주소
     * @param _day 조회할 날짜 인덱스 (0-base, 베스팅 시작일 기준)
     * @return 해당 날짜에 유효한 구매 박스 보유량
     * @dev 
     * - 내부 _balanceAtDay 함수를 호출하여 체크포인트 기반 보유량 계산
     * - day는 베스팅 시작일을 0으로 하는 인덱스
     * - 체크포인트가 없는 경우 0 반환
     */
    function buyerBoxesAtDay(address _user, uint256 _day) external view returns (uint256) {
        return _balanceAtDay(buyerBoxAmountHistory[_user], _day);
    }

    /**
     * @notice 특정 시점 기준 사용자의 구매 박스 보유량 조회
     * @param _user 조회할 사용자 주소
     * @param _ts 조회할 시점 (Unix timestamp)
     * @return 해당 시점에 유효한 구매 박스 보유량
     * @dev 
     * - timestamp를 베스팅 시작일 기준 day 인덱스로 변환
     * - ts < vestingStartDate인 경우 day = 0으로 처리
     * - 내부 _balanceAtDay 함수를 호출하여 체크포인트 기반 보유량 계산
     * - 실시간 보유량 조회에 유용한 함수
     */
    function buyerBoxesAtTs(address _user, uint256 _ts) external view returns (uint256) {
        uint256 d = (_ts < vestingStartDate) ? 0 : (_ts - vestingStartDate) / SECONDS_PER_DAY;
        return _balanceAtDay(buyerBoxAmountHistory[_user], d);
    }

    /**
     * @notice bytes8 변수를 string으로 변환한다.
     * @param _code string으로 변환할 bytes8 변수
     * @return 변환된 string값
     * @dev 레퍼럴 (8자리 bytes)을 string으로 변환하기 위한 함수이다.
     * ex.
     *     code = bytes8(0x4142434445464748) → "ABCDEFGH"
     *     code = bytes8(0x3031323334353637) → "01234567"
    */
    function bytes8ToString(bytes8 _code) public pure returns (string memory) {
        bytes memory out = new bytes(8);
        uint64 v = uint64(_code);
        // bytes8의 각 byte를 masking하여 out 버퍼에 담음
        for (uint256 i = 0; i < 8; i++) {
            out[7 - i] = bytes1(uint8(v & 0xFF));
            v >>= 8;
        }
        // out 버퍼를 string으로 형변환 (bytes와 string은 메모리 구조가 같음 => typecasting만으로 변환 가능)
        return string(out);
    }

    /**
     * @notice 지정된 수량의 박스 구매 시 예상 총 금액 조회 (할인율 적용)
     * @param _boxAmount 구매할 박스 수량
     * @param _refCodeStr 8자리 레퍼럴 코드 문자열
     * @return price 할인율이 적용된 총 구매 금액 (USDT 6 decimals)
     * @dev 
     * - 레퍼럴 코드의 유효성을 검증하고 해당 코드의 할인율 적용
     * - 유효하지 않은 레퍼럴 코드인 경우 0 반환
     * - 수량별 단계별 가격 계산 후 할인율 적용하여 총 금액 반환
     * APP에서 호출됨
     */
    function estimatedTotalAmount(
        uint256 _boxAmount,
        string calldata _refCodeStr 
    ) public view returns (uint256 price) {
        bytes8  code = _normalizeToBytes8(_refCodeStr);
        if (codeToOwner[code] == address(0)) {
            return 0;
        }
        uint256 discountRate = refDiscountOf[code];
        price = _calculatePurchasePrice(_boxAmount, discountRate);
    }

    /**
     * @notice 현재 시점 기준 1박스 구매 가격 조회 (할인율 적용)
     * @param _refCodeStr 8자리 레퍼럴 코드 문자열
     * @return price 할인율이 적용된 1박스 구매 가격 (USDT 6 decimals)
     * @dev 
     * - 레퍼럴 코드의 유효성을 검증하고 해당 코드의 할인율 적용
     * - 유효하지 않은 레퍼럴 코드인 경우 0 반환
     * - 1박스 기준으로 가격 계산하여 반환
     * APP에서 호출됨
     */
    function getCurrentBoxPrice(
        string calldata _refCodeStr 
    ) external view returns (uint256 price) {
        bytes8  code = _normalizeToBytes8(_refCodeStr);
        uint256 discountRate = (codeToOwner[code] == address(0))? 0: refDiscountOf[code];
        price = _calculatePurchasePrice(1, discountRate);
    }

    /**
     * @notice 레퍼럴 코드 문자열로 소유자 주소 조회
     * @param _refCodeStr 8자리 레퍼럴 코드 문자열
     * @return 해당 코드의 소유자 주소
     * @dev 문자열 형태의 레퍼럴 코드를 정규화하여 소유자 주소 반환
     */
    function getRefererByCode(string calldata _refCodeStr) external view returns (address) {
        (address referrer, ) = _referrerFromString(_refCodeStr);
        return referrer;
    }

    /**
     * @notice 사용자의 레퍼럴 코드를 문자열로 조회
     * @param _user 레퍼럴 코드를 조회할 사용자 주소
     * @return 8자리 레퍼럴 코드 문자열 (예: "ABCD1234")
     * @dev bytes8 형태의 레퍼럴 코드를 읽기 쉬운 문자열로 변환
     */
    function getReferralCode(address _user) external view returns (string memory) {
        bytes8 code = referralCodeOf[_user];
        require(code != bytes8(0), "no code");
        return bytes8ToString(code);
    }

    /**
     * @notice 구매한 총 박스 수 읽어오기
     * @return 구매한 총 박스 수
     * @dev sync가 호출되지 않은 최초 구간일 경우, boxesAddedPerDay[0] 반환
     * APP에서 호출됨
     */
    function getTotalBoxPurchased() public view returns (uint256) {
        if (lastSyncedDay == 0) { // 아직 아무 날도 확정되지 않은 초기 구간
            return boxesAddedPerDay[0];
        }
        uint256 finalized = cumBoxes[lastSyncedDay - 1];        // 어제까지 확정 누적
        uint256 todayIndex = (block.timestamp < vestingStartDate)? 0 : (block.timestamp - vestingStartDate) / SECONDS_PER_DAY;
        uint256 pending = 0;
        for (uint256 d = lastSyncedDay; d <= todayIndex; d++) {
            pending += boxesAddedPerDay[d];
        }
        return finalized + pending;
    }

    /**
     * @notice 유저가 purchasePool에서 vesting 받은 순수 총 합산값을 얻어온다.
     * @param _user 유저 주소
     * @return total 유저가 purchasePool에서 vesting 받은 순수 총 합산값
     * @dev 총 purchasePool vesting 양 + 클레임해 간 양
     * APP에서 호출됨
     */
    function getTotalEarnedByPurchaseVesting(address _user) external view returns(uint256 total) {
        total = _applyFloor6(_previewBuyerClaimableAtTs(_user, block.timestamp)) + totalClaimedBuyer[_user];
    }

    /**
     * @notice 유저가 referralPool에서 vesting 받은 순수 총 합산값을 얻어온다.
     * @param _user 유저 주소
     * @return total 유저가 referralPool에서 vesting 받은 순수 총 합산값
     * @dev 총 referralPool vesting 양 + 클레임해 간 양
     */
    function getTotalEarnedByReferralVesting(address _user) external view returns(uint256 total) {
        total = _applyFloor6(_previewReferrerClaimableAtTs(_user, block.timestamp)) + totalClaimedReferral[_user];
    }

    /**
     * @notice 레퍼럴로 구매된 총 박스 수 읽어오기
     * @return 레퍼럴로 구매된 총 박스 수
     * @dev sync가 호출되지 않은 최초 구간일 경우, referralsAddedPerDay[0] 반환
     */
    function getTotalReferralUnits() public view returns (uint256) {
        if (lastSyncedDay == 0) {
            return referralsAddedPerDay[0];
        }
        uint256 finalized = cumReferals[lastSyncedDay - 1];
        uint256 todayIndex = (block.timestamp < vestingStartDate)? 0 : (block.timestamp - vestingStartDate) / SECONDS_PER_DAY;
        uint256 pending = 0;
        for (uint256 d = lastSyncedDay; d <= todayIndex; d++) {
            pending += referralsAddedPerDay[d];
        }
        return finalized + pending;
    }

    /**
     * @notice 현재 시점 기준 구매자 클레임 가능한 보상 미리보기
     * @param _user 보상을 조회할 사용자 주소
     * @return 클레임 가능한 총 보상량 (18 decimals)
     * @dev 현재 블록 타임스탬프를 기준으로 시뮬레이션
     * 호출전에 반드시 sync() 호출되어 있어야 함
     * APP에서 호출됨
     */
    function previewBuyerClaimable(address _user) external view returns (uint256) {
        return _previewBuyerClaimableAtTs(_user, block.timestamp);
    }

    /**
     * @notice 특정 시점 기준 구매자 클레임 가능한 보상 미리보기
     * @param _user 보상을 조회할 사용자 주소
     * @param _ts 기준 시각 (Unix timestamp)
     * @return 클레임 가능한 총 보상량 (18 decimals)
     * @dev 지정된 타임스탬프까지의 보상을 시뮬레이션
     * 호출전에 반드시 sync() 호출되어 있어야 함
     */
    function previewBuyerClaimableAt(address _user, uint256 _ts) external view returns (uint256) {
        return _previewBuyerClaimableAtTs(_user, _ts);
    }

    /**
     * @notice 구매자 풀 기준: 어제 하루 동안 벌어진 양. 클레임/동기화와 무관.
     * @param _user 조회할 사용자 주소
     * @return pay6 어제 하루 동안 벌어진 구매자 풀 보상 (18dec 기준, 소수 6자리 절삭(하위 12자리 0))
     * @dev 
     * - 현재 시점을 기준으로 어제 하루의 보상만 계산
     * - 베스팅 시작일 이전이면 0 반환
     * - _previewBuyerPendingAt으로 어제 하루치 보상 계산 후 6dec 절삭
     * - 실제 클레임이나 동기화와 무관한 순수 계산 함수
     * - 실시간 대시보드나 UI 표시용으로 활용 가능
     * APP에서 호출됨
     */
    function previewBuyerEarnedYesterday(address _user) external view returns (uint256 pay6) {
        uint256 todayStart = _dayStart(block.timestamp);
        if (todayStart <= vestingStartDate) return 0;

        uint256 yIndex = ((todayStart - vestingStartDate) / SECONDS_PER_DAY) - 1;
        uint256 amount18;

        if (lastSyncedDay != 0 && yIndex < lastSyncedDay) {
            // 이미 확정된 '어제'라면 확정값 사용
            uint256 per = rewardPerBox[yIndex]; // 18dec
            uint256 bal = _balanceAtDay(buyerBoxAmountHistory[_user], yIndex);
            amount18 = per * bal;
        } else {
            // 미확정이면 1일치 시뮬레이션으로 계산
            amount18 = _previewBuyerPendingAt(_user, yIndex, yIndex); // 18dec
        }

        return _applyFloor6(amount18);
    }

    /**
     * @notice 현재 시점 기준 추천인 클레임 가능한 보상 미리보기
     * @param _user 보상을 조회할 추천인 주소
     * @return 클레임 가능한 총 보상량 (18 decimals)
     * @dev 현재 블록 타임스탬프를 기준으로 시뮬레이션
     * APP에서 호출됨
     */
    function previewReferrerClaimable(address _user) external view returns (uint256) {
        return _previewReferrerClaimableAtTs(_user, block.timestamp);
    }
    
    /**
     * @notice 특정 시점 기준 추천인 클레임 가능한 보상 미리보기
     * @param _user 보상을 조회할 추천인 주소
     * @param _ts 기준 시각 (Unix timestamp)
     * @return 클레임 가능한 총 보상량 (18 decimals)
     * @dev 지정된 타임스탬프까지의 보상을 시뮬레이션
     */
    function previewReferrerClaimableAt(address _user, uint256 _ts) external view returns (uint256) {
        return _previewReferrerClaimableAtTs(_user, _ts);
    }

    /**
     * @notice 추천인 풀 기준: 어제 하루 동안 벌어진 양(6dec, 절삭). 클레임/동기화와 무관.
     * @param _user 조회할 추천인 주소
     * @return pay6 어제 하루 동안 벌어진 추천인 풀 보상 (6 decimals, 절삭)
     * @dev 
     * - 현재 시점을 기준으로 어제 하루의 레퍼럴 보상만 계산
     * - 베스팅 시작일 이전이면 0 반환
     * - _previewRefPendingAt으로 어제 하루치 레퍼럴 보상 계산 후 6dec 절삭
     * - 실제 클레임이나 동기화와 무관한 순수 계산 함수
     * - 실시간 대시보드나 UI 표시용으로 활용 가능
     */
    function previewReferrerEarnedYesterday(address _user) external view returns (uint256 pay6) {
        uint256 todayStart = _dayStart(block.timestamp);
        if (todayStart <= vestingStartDate) {
            return 0;
        }

        uint256 yIndex = ((todayStart - vestingStartDate) / SECONDS_PER_DAY) - 1;
        uint256 amount18;

        if (lastSyncedDay != 0 && yIndex < lastSyncedDay) {
            uint256 per = rewardPerReferral[yIndex]; // 18dec
            uint256 bal = _balanceAtDay(referralAmountHistory[_user], yIndex);
            amount18 = per * bal;
        } else {
            amount18 = _previewRefPendingAt(_user, yIndex, yIndex); // 18dec
        }

        return _applyFloor6(amount18);
    }

    /**
     * @notice user의 레퍼럴로 구매한 박스수량을 반환한다.
     * @param _user 조회할 추천인 주소
     * @return user의 레퍼럴로 구매한 박스수량
     * @dev APP에서 호출됨
     */
    function referralsOf(address _user) external view returns (uint256) {
        BoxAmountCheckpoint[] storage hist = referralAmountHistory[_user];
        return hist.length == 0 ? 0 : hist[hist.length - 1].amount;
    }

    /**
     * @notice 특정 날짜 기준 사용자의 레퍼럴 유치 단위 보유량 조회
     * @param _user 조회할 추천인 주소
     * @param _day 조회할 날짜 인덱스 (0-base, 베스팅 시작일 기준)
     * @return 해당 날짜에 유효한 레퍼럴 유치 단위 보유량
     * @dev 
     * - 내부 _balanceAtDay 함수를 호출하여 체크포인트 기반 보유량 계산
     * - day는 베스팅 시작일을 0으로 하는 인덱스
     * - 체크포인트가 없는 경우 0 반환
     * - 레퍼럴 보상 계산에 사용되는 핵심 데이터
     */
    function referralUnitsAtDay(address _user, uint256 _day) external view returns (uint256) {
        return _balanceAtDay(referralAmountHistory[_user], _day);
    }

    /**
     * @notice 특정 시점 기준 사용자의 레퍼럴 유치 단위 보유량 조회
     * @param _user 조회할 추천인 주소
     * @param _ts 조회할 시점 (Unix timestamp)
     * @return 해당 시점에 유효한 레퍼럴 유치 단위 보유량
     * @dev 
     * - timestamp를 베스팅 시작일 기준 day 인덱스로 변환
     * - ts < vestingStartDate인 경우 day = 0으로 처리
     * - 내부 _balanceAtDay 함수를 호출하여 체크포인트 기반 보유량 계산
     * - 실시간 레퍼럴 보상 계산에 유용한 함수
     */
    function referralUnitsAtTs(address _user, uint256 _ts) external view returns (uint256) {
        uint256 d = (_ts < vestingStartDate) ? 0 : (_ts - vestingStartDate) / SECONDS_PER_DAY;
        return _balanceAtDay(referralAmountHistory[_user], d);
    }

    /**
     * @notice TokenVesting 컨트랙트의 StableCoin 잔량을 얻어온다.
     * @return totalAmount TokenVesting 컨트랙트의 StableCoin 잔량
     */
    function totalStableCoinAmount() external view returns (uint256 totalAmount) {
        totalAmount = stableCoin.balanceOf(address(this));
    }

    /**
     * @notice 18dec 금액을 소수 6자리로 절삭(항상 적용) - 정밀도 조정
     * @param _amount18 18 decimals 기준 금액
     * @return 6 decimals로 절삭된 금액
     * @dev 
     * - 18 decimals에서 6 decimals로 변환 시 하위 12자리 절삭
     * - 항상 내림 처리하여 사용자에게 과다 지급 방지
     * - 최종 지급액 계산 시 반드시 적용
     */
    function _applyFloor6(uint256 _amount18) internal pure returns (uint256) {
        uint256 mod = 1e12; // 10^(18-6)
        return _amount18 - (_amount18 % mod);
    }

    // ===== balances snapshot helpers =====

    /**
     * @notice 특정 날짜 기준 사용자의 보유량 조회 - 체크포인트 기반
     * @param _hist 사용자의 체크포인트 히스토리 배열
     * @param _day 조회할 날짜 인덱스 (0-base)
     * @return 해당 날짜에 유효한 보유량
     * @dev 
     * - 체크포인트 배열을 순회하며 day 이하의 가장 최근 체크포인트 찾기
     * - 체크포인트가 없으면 0 반환
     * - 체크포인트의 day는 해당 날짜부터 효력이 생기는 시점
     * - 효율적인 이진 탐색 대신 선형 탐색 사용 (체크포인트 수가 적음)
     */
    function _balanceAtDay(BoxAmountCheckpoint[] storage _hist, uint256 _day) internal view returns (uint256) {
        uint256 n = _hist.length;
        if (n == 0) {
            return 0;
        }
        uint256 i = 0;
        uint256 cur = 0;
        while (i < n && _hist[i].day <= _day) {
            cur = _hist[i].amount;
            unchecked { i++; }
        }
        return cur;
    }

    /**
     * @notice 박스 구매 내부 로직 - 실제 구매 처리
     * @param _boxCount 구매할 박스 수량
     * @param _refCodeStr 8자리 레퍼럴 코드 문자열
     * @param _usePermit permit 사용 여부
     * @param _p EIP-2612 permit 데이터
     * @dev 
     * - 구매 전 sync() 호출로 보상 확정
     * - 자기추천 방지 (referrer != msg.sender)
     * - 구매 당일 분배 참여, 익일 00:00 확정
     * - 레퍼럴이 있는 경우 바이백 10% 적립
     */
    function _buy(
        uint256 _boxCount, 
        string calldata _refCodeStr, 
        bool _usePermit, 
        PermitData memory _p
    ) internal {
        require(scheduleInitialized, "no schedule");
        require(block.timestamp >= vestingStartDate, "not started");
        uint256 lastEnd = poolEndTimes[poolEndTimes.length - 1];
        require(block.timestamp <= lastEnd, "vesting ended");
        require(_boxCount > 0, "box=0");

        address sender = _msgSender();

        (address referrer, bytes8 normCode) = _referrerFromString(_refCodeStr);
        require(referrer != sender, "self referral");

        sync();

        uint256 estimatedPrice = estimatedTotalAmount(_boxCount, _refCodeStr);
        require(estimatedPrice == _p.value, "The amount to be paid is incorrect.");

        if (_usePermit) {
            IERC20Permit(address(stableCoin)).permit(
                sender, address(this),
                _p.value, _p.deadline, _p.v, _p.r, _p.s
            );
        }
        if(!stableCoin.transferFrom(sender, address(this), estimatedPrice)) {
            revert StableCoinTransferFailed();
        }

        // BUYBACK_PERCENT에 해당하는 금액만 남기고 나머지는 Recipient에게 전송
        uint256 buyback = (estimatedPrice * BUYBACK_PERCENT) / 100;
        buybackStableCoinAmount[referrer] += buyback; // 바이백 받을 양 기록
        require(recipient != address(0), "recipient not set");
        if(!stableCoin.transfer(recipient, (estimatedPrice - buyback))) {
            revert StableCoinTransferFailed();
        }

        uint256 dToday = (block.timestamp - vestingStartDate) / SECONDS_PER_DAY;
        boxesAddedPerDay[dToday]     += _boxCount;
        referralsAddedPerDay[dToday] += _boxCount;

        _pushBuyerCheckpoint(sender, dToday, _boxCount);
        _pushRefCheckpoint(referrer, dToday, _boxCount);
        _ensureReferralCode(sender);

        emit BoxesPurchased(sender, _boxCount, referrer, estimatedPrice, buyback, normCode, (uint64)(block.timestamp));

        totalBoughtBoxes[sender] += _boxCount; // ① 누적 구매량 갱신
        uint256 sbtId = _ensureSbt(sender); // ② 첫 구매면 SBT 민트
        _upgradeBadgeIfNeeded(sender, sbtId); // ③ 등급 갱신(URI 업데이트)
    }

    /**
     * @notice 체크포인트 히스토리 기반으로 보상 계산 - 확정된 보상
     * @param _hist BoxAmountCheckpoint 구조체
     * @return total 해당 구간의 총 보상량 (18 decimals)
     * @dev 
     * - 체크포인트의 효력 시작 시점을 기준으로 보유량 변화 추적
     * - 각 구간별로 보유량 × 누적 보상 차이 계산
     * - prefix-sum 방식으로 효율적인 구간 합 계산
     */
    function _calcByHistory(
        BoxAmountCheckpoint[] storage _hist,
        mapping(uint256 => uint256) storage cumReward,
        uint256 fromDay,
        uint256 toDay
    ) internal view returns (uint256 total) {
        if (fromDay > toDay) {
            return 0;
        }
        uint256 n = _hist.length;
        if (n == 0) {
            return 0;
        }
        uint256 i = 0;
        uint256 curBal = 0;
        while (i < n && _hist[i].day <= fromDay) {
            curBal = _hist[i].amount; 
            unchecked { 
                i++; 
            } 
        }

        uint256 segStart = fromDay;
        uint256 nextDay = (i < n) ? _hist[i].day : (toDay + 1);
        uint256 segEnd   = nextDay > 0 ? toDay.min(nextDay - 1) : toDay;

        if (segEnd >= segStart && curBal > 0) {
            total += curBal * _rangeSum(cumReward, segStart, segEnd);
        }

        while (i < n && _hist[i].day <= toDay) {
            curBal  = _hist[i].amount;
            segStart = _hist[i].day;
            unchecked {
                i++; 
            }
            nextDay = (i < n) ? _hist[i].day : (toDay + 1);
            segEnd  = nextDay > 0 ? toDay.min(nextDay - 1) : toDay;

            if (segEnd >= segStart && curBal > 0) {
                total += curBal * _rangeSum(cumReward, segStart, segEnd);
            }
        }
    }

    /**
     * @notice 박스 구매 가격 계산 - 단계별 가격 정책 적용
     * @param _quantity 구매할 박스 수량
     * @param _discountRate 적용할 할인율 (0-100, 10이면 10% 할인)
     * @return totalPrice 할인이 적용된 총 구매 금액 (USDT 6 decimals)
     * @dev 
     * - 200개 단위로 25 USDT씩 인상되는 단계별 가격 정책
     * - 0~2999: 350 USDT, 3000~3199: 350 USDT, 3200~3399: 375 USDT
     * - ... 9800~9999: 1200 USDT, 10000 이상: 1300 USDT (고정)
     * - 수량이 여러 단계에 걸쳐 있는 경우 각 단계별로 계산 후 합산
     * - 최종 가격에 할인율 적용하여 반환
     */
    function _calculatePurchasePrice(
        uint256 _quantity,
        uint256 _discountRate
    ) internal view returns (uint256 totalPrice) {
        uint256 sold = getTotalBoxPurchased();
        uint256 idx = sold + 1;  // 첫 구매 인덱스(1-based)
        uint256 remain = _quantity;

        // 상수들 (USDT 6 decimals)
        uint256 basePrice = 350e6; // 시작가
        uint256 stepAmount = 25e6; // 스텝당 +$25
        uint256 stepUnits = 200; // 200개 단위
        uint256 hardCap = 10000; // 10000 초과부터 1300
        uint256 capPrice = 1300e6; // 1300 USDT

        uint256 sum = 0;

        while (remain != 0) {
            // 10000 초과 구간은 전부 1300 고정
            if (idx >= hardCap) {
                sum += capPrice * remain;
                break;
            }
            // 현재 idx가 속한 스텝 계산 (3000 이하는 step = 0)
            uint256 step = idx <= 3000 ? 0 : (idx - 3000) / stepUnits;
            // 해당 스텝의 단가
            uint256 unit = basePrice + stepAmount * step;

            // 해당 스텝의 마지막 인덱스(상한 9999)
            uint256 boundaryEnd = 3199 + step * stepUnits; // 3000~3199: step=0
            if (boundaryEnd > 9999) {
                boundaryEnd = 9999;
            }
            // 이번 스텝에서 소화 가능한 개수
            uint256 canBuy = boundaryEnd + 1 - idx;
            if (canBuy > remain) {
                canBuy = remain;
            }
            sum += unit * canBuy;
            // 다음 구간으로 이동
            idx += canBuy;
            remain -= canBuy;
        }
        // 할인 적용 (예: _discountRate=10 → 10% 할인)
        uint256 discount = 100 - _discountRate;
        totalPrice = sum * discount / 100;
    }

    /**
     * @notice 사용자의 클레임 가능한 구간 계산 - 클레임 윈도우
     * @param _lastClaimed 마지막으로 클레임한 일 인덱스 (UNSET이면 처음)
     * @return fromDay 클레임 시작 일 인덱스 (포함)
     * @return toDay 클레임 종료 일 인덱스 (포함)
     * @dev 
     * - lastClaimed 이후부터 lastSyncedDay-1까지의 구간 반환
     * - UNSET인 경우 처음부터 시작 (0부터)
     * - 아직 확정된 날이 없으면 (1, 0) 반환하여 클레임 불가 표시
     */
    function _claimWindow(uint256 _lastClaimed) internal view returns (uint256 fromDay, uint256 toDay) {
        if (lastSyncedDay == 0) {
            return (1, 0);
        }
        uint256 lastFinal = lastSyncedDay - 1;
        fromDay = (_lastClaimed == UNSET) ? 0 : (_lastClaimed + 1);
        toDay = lastFinal;
    }

    /**
     * @notice 자정 시각 기준 일일 풀 계산(마지막 날 보정 포함) — 연차별 실제 일수(termDays) 기반
     * @param _dayStartTs 기준 시각 (Unix timestamp)
     * @param _forBuyer true면 구매자 풀, false면 추천인 풀 계산
     * @return 해당 날짜의 일일 풀 크기 (18 decimals)
     * @dev 
     * - 연차별 총량을 해당 연차의 실제 일수로 나누어 일일 풀 계산
     * - 마지막 날에는 잔여 보정을 통해 정확한 총량 분배
     * - 구매자 풀과 추천인 풀을 구분하여 계산
     */
    function _dailyPoolRawByTs(uint256 _dayStartTs, bool _forBuyer) internal view returns (uint256) {
        if (!scheduleInitialized) {
            return 0;
        }
        uint256 y = _yearByTs(_dayStartTs);
        if (y >= poolEndTimes.length) {
            return 0;
        }
        uint256 total = _forBuyer ? buyerPools[y] : refererPools[y];
        if (total == 0) {
            return 0;
        }

        uint256 yStart = _yearStartTs(y);
        uint256 inYear = (_dayStartTs - yStart) / SECONDS_PER_DAY; // 0..termDays-1
        uint256 termDays = _termDays(y);

        uint256 base = total / termDays;
        if (inYear == termDays - 1) {
            // 마지막 날 잔여 보정
            return total - base * (termDays - 1);
        }
        return base;
    }

    /**
     * @notice 특정 시점의 하루 시작 시각(자정)을 계산하는 내부 함수
     * @param _ts 기준 시각 (Unix timestamp)
     * @return 해당 시점이 속한 하루의 시작 시각 (자정, UTC 00:00)
     * @dev 
     * - 베스팅 시작일 이전이면 vestingStartDate 반환
     * - 베스팅 시작일 이후면 해당 시각이 속한 하루의 자정 시각 반환
     * - SECONDS_PER_DAY(86400초) 단위로 정확한 하루 경계 계산
     * - unchecked 블록으로 가스 최적화 (오버플로우 불가능)
     */
    function _dayStart(uint256 _ts) internal view returns (uint256) {
        if (_ts <= vestingStartDate) {
            return vestingStartDate;
        }
        unchecked {
            return vestingStartDate + ((_ts - vestingStartDate) / SECONDS_PER_DAY) * SECONDS_PER_DAY;
        }
    }

    /**
     * @notice 사용자에게 고유한 레퍼럴 코드 할당 - 자동 코드 생성
     * @param _user 레퍼럴 코드를 할당할 사용자 주소
     * @return code 할당된 8자리 레퍼럴 코드
     * @dev 
     * - 이미 할당된 코드가 있으면 기존 코드 반환
     * - 없으면 keccak256 해시 기반으로 고유한 8자리 코드 생성
     * - A-Z, 0-9 문자만 사용하여 읽기 쉬운 코드 생성
     * - 충돌 방지를 위해 salt를 증가시키며 반복
     */
    function _ensureReferralCode(address _user) internal returns (bytes8 code) {
        code = referralCodeOf[_user];
        if (code != bytes8(0)) {
            return code; // 이미 할당된 코드가 있으면 기존 코드 반환
        }
        uint256 salt = 0;
        while (true) {
            bytes8 raw = bytes8(keccak256(abi.encodePacked(_user, salt)));
            bytes memory buf = new bytes(8);
            for (uint256 i = 0; i < 8; i++) {
                uint8 x = uint8(uint64(uint64(bytes8(raw)) >> (i * 8)));
                uint8 m = x % 36; // A-Z,0-9 총 36개
                buf[7 - i] = bytes1(m < 26 ? (65 + m) : (48 + (m - 26)));
            }
            uint64 acc = 0;
            for (uint256 i = 0; i < 8; i++) {
                acc = (acc << 8) | uint64(uint8(buf[i]));
            }
            bytes8 cand = bytes8(acc);
            if (cand != bytes8(0) && codeToOwner[cand] == address(0)) {
                referralCodeOf[_user] = cand;
                codeToOwner[cand] = _user;
                emit ReferralCodeAssigned(_user, cand);
                return cand;
            }
            unchecked {
                ++salt;
            }
        }
    }

    /**
     * @notice 사용자의 SBT 토큰을 보장하는 내부 함수 - SBT 토큰 민팅
     * @param _user SBT 토큰을 보장할 사용자 주소
     * @return tokenId 사용자의 SBT 토큰 ID (기존 또는 새로 민팅된 것)
     * @dev 
     * - BadgeSBT 컨트랙트가 설정되지 않은 경우 0 반환 (무시)
     * - 사용자가 이미 SBT 토큰을 가지고 있으면 기존 tokenId 반환
     * - 첫 번째 SBT 토큰인 경우 빈 URI로 민팅 후 tokenId 반환
     * - 민팅 완료 시 BadgeSBTMinted 이벤트 발생
     * - SBT_BURNAUTH.Neither로 설정하여 소각 불가능하게 설정
     */
    function _ensureSbt(address _user) internal returns (uint256 tokenId) {
        address sbtAddr = address(badgeSBT);
        // SBT 미설정 or 잘못된 주소(EOA 등)면 스킵
        if (sbtAddr == address(0) || sbtAddr.code.length == 0) {
            return 0;
        }
        tokenId = sbtIdOf[_user];
        if (tokenId != 0) return tokenId;

        uint256 newId = badgeSBT.mint(_user, SBT_BURNAUTH);
        sbtIdOf[_user] = newId;
        emit BadgeSBTMinted(_user, newId);
        tokenId = newId;
    }

    /**
     * @notice string 변수를 bytes8로 변환한다.
     * @param _s bytes8로 변환할 string 변수
     * @return out 변환된 bytes8값
     * @dev 대문자로 정규화작업 후, A-Z/0-9만 허용한다.
     * ex.
     *     s = "ABCDEFGH" -> bytes8(0x4142434445464748)
     *     s = "01234567" -> bytes8(0x3031323334353637)
     */
    function _normalizeToBytes8(string memory _s) internal pure returns (bytes8 out) {
        bytes memory b = bytes(_s);
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

    /**
     * @notice 특정 시점 기준 구매자 클레임 가능한 보상 미리보기 - 내부 계산
     * @param _user 보상을 조회할 사용자 주소
     * @param _ts 기준 시각 (Unix timestamp)
     * @return total 클레임 가능한 총 보상량 (18 decimals)
     * @dev 
     * - 확정된 보상과 미확정 보상을 모두 계산하여 총 클레임 가능량 반환
     * - 확정된 보상: _calcByHistory로 체크포인트 기반 계산
     * - 미확정 보상: _previewBuyerPendingAt으로 시뮬레이션
     */
    function _previewBuyerClaimableAtTs(address _user, uint256 _ts) internal view returns (uint256) {
        (uint256 fromDay0, uint256 toDay0) = _claimWindow(lastBuyerClaimedDay[_user]);
        (uint256 previewLast, uint256 dNext) = _previewLastFinalAt(_ts);

        uint256 total = 0;
        if (fromDay0 <= toDay0) {
            total += _calcByHistory(buyerBoxAmountHistory[_user], cumRewardPerBox, fromDay0, toDay0);
        }
        // uint256 startSim = fromDay0 > lastSyncedDay ? fromDay0 : lastSyncedDay;
        uint256 startSim = lastSyncedDay;
        if (dNext > lastSyncedDay && startSim <= previewLast) {
            total += _previewBuyerPendingAt(_user, startSim, previewLast);
        }
        return total;
    }

    /**
     * @notice startSim ~ endSim까지의 purchasePool에 대한 유저가 받을 vesting양을 계산한다.
     * @param _user 보상을 계산할 사용자 주소
     * @param _startSim 시뮬레이션 시작 일 인덱스 (포함)
     * @param _endSim 시뮬레이션 종료 일 인덱스 (포함)
     * @return total 해당 구간의 총 예상 보상량 (18 decimals)
     * @dev
     * - day d의 유저 하루치 = (pool_d) / (denom_{d-1}) * (curBal_d)
     *      pool_d: 그 날의 구매 풀 일일량
     *      denom_{d-1}: 전일까지 누적 박스 수
     *      curBal_d: 해당 일에 유효한 유저 박스 수
     * - 분모 denom은 항상 "전일까지의 누적"을 사용합니다.
     * - 유저 박스 잔액(curBal)은 체크포인트의 effDay(= 구매일+1) 기준으로 d일에 유효한 값으로 갱신합니다.
     * - 결과값은 18 decimals 기준 누적 예상치입니다. (실지급 시에는 _applyFloor6로 6자리 절삭)
     */
    function _previewBuyerPendingAt(
        address _user,
        uint256 _startSim,
        uint256 _endSim
    ) internal view returns (uint256 total) {
        // ── 1) 유저의 박스 보유량 체크포인트 로딩
        BoxAmountCheckpoint[] storage hist = buyerBoxAmountHistory[_user];
        uint256 n = hist.length;

        // _startSim 시점(포함)에 유효한 유저 박스 잔액(curBal)으로 맞추기 위한 준비
        uint256 i = 0;
        uint256 curBal = 0;

        // hist[i].day <= _startSim 인 마지막 체크포인트를 찾아 curBal에 반영
        // (체크포인트 day는 effDay: 해당 day부터 효력이 생김)
        while (i < n && hist[i].day <= _startSim) {
            curBal = hist[i].amount;
            unchecked {
                i++;
            }
        }

        // ── 2) 분모(전일까지 누적 박스 수) 초기화
        // 마지막으로 확정된 날이 (lastSyncedDay - 1)이므로 그 시점의 누적(cumBoxes[lastSyncedDay - 1])에서 시작
        uint256 prevBoxes = (lastSyncedDay == 0) ? 0 : cumBoxes[lastSyncedDay - 1];

        // lastSyncedDay..(_startSim-1) 사이에 확정은 안 되었지만 기록된 판매량을 가상 누적치에 더해,
        // startSim의 "당일 누적"을 prevBoxes로 맞춰둔다.
        if (_startSim > lastSyncedDay) {
            for (uint256 dd = lastSyncedDay; dd < _startSim; dd++) {
                prevBoxes += boxesAddedPerDay[dd];
            }
        }
        // ── 3) 일 단위 시뮬레이션 루프: _startSim.._endSim (둘 다 포함)
        for (uint256 d = _startSim; d <= _endSim; d++) {
            // d일에 효력 시작하는 체크포인트가 있으면 유저 잔액(curBal) 갱신
            while (i < n && hist[i].day <= d) {
                curBal = hist[i].amount;
                unchecked {
                    i++;
                }
            }
            // 분모: 항상 "전일까지의 누적 박스 수"
            uint256 denom = prevBoxes + boxesAddedPerDay[d];

            if (denom > 0 && curBal > 0) {
                // 해당 날짜(day d)의 자정 타임스탬프
                uint256 dayStartTs = vestingStartDate + d * SECONDS_PER_DAY;

                // 그 날의 구매 풀 일일량(18dec). 마지막 날은 잔여 보정(_dailyPoolRawByTs 내부 로직)
                uint256 pool = _dailyPoolRawByTs(dayStartTs, true);

                if (pool > 0) {
                    // 현재 구현(곱→나눗셈 순서)에서는 나눗셈 내림에 따른 손실이 먼저 발생할 수 있음.
                    total += curBal * (pool / denom);
                }
            }
            // 다음 날(d+1)을 위해 누적 박스 수를 갱신:
            // "오늘(d) 추가된 판매량"을 전일까지 누적치(prevBoxes)에 더해 둔다.
            prevBoxes += boxesAddedPerDay[d];
        }
    }

    /**
     * @notice ts 시점에 sync()를 가정한 “예상 확정 범위”를 계산한다.
     * @dev lastSyncedDay(d)와 nextSyncTs를 기준으로, ts까지 경과한 ‘완전한 하루(UTC 00:00 경계)’를 deltaDays로 산출함.
     * @param _ts 기준 시각(Unix epoch sec)
     * @return previewLastFinal 가상 마지막 확정 일(day) 인덱스
     * @return dNext 가상 lastSyncedDay(확정된 총 일수)
     */
    function _previewLastFinalAt(uint256 _ts) internal view returns (uint256 previewLastFinal, uint256 dNext) {
        uint256 tmpNext = nextSyncTs;
        uint256 d = lastSyncedDay;
        while (tmpNext + SECONDS_PER_DAY <= _ts) {
            tmpNext += SECONDS_PER_DAY;
            unchecked { d++; }
        }
        previewLastFinal = (d == 0) ? 0 : (d - 1);
        dNext = d;
    }

    /**
     * @notice 특정 시점 기준 추천인 클레임 가능한 보상 미리보기 - 내부 계산
     * @param _user 보상을 조회할 추천인 주소
     * @param _ts 기준 시각 (Unix timestamp)
     * @return total 클레임 가능한 총 보상량 (18 decimals)
     * @dev 
     * - 확정된 보상과 미확정 보상을 모두 계산하여 총 클레임 가능량 반환
     * - 확정된 보상: _calcByHistory로 체크포인트 기반 계산
     * - 미확정 보상: _previewRefPendingAt으로 시뮬레이션
     */
    function _previewReferrerClaimableAtTs(address _user, uint256 _ts) internal view returns (uint256) {
        (uint256 fromDay0, uint256 toDay0) = _claimWindow(lastRefClaimedDay[_user]);
        (uint256 previewLast, uint256 dNext) = _previewLastFinalAt(_ts);

        uint256 total = 0;
        if (fromDay0 <= toDay0) {
            total += _calcByHistory(referralAmountHistory[_user], cumRewardPerReferral, fromDay0, toDay0);
        }
        // uint256 startSim = fromDay0 > lastSyncedDay ? fromDay0 : lastSyncedDay;
        uint256 startSim = lastSyncedDay;
        if (dNext > lastSyncedDay && startSim <= previewLast) {
            total += _previewRefPendingAt(_user, startSim, previewLast);
        }
        return total;
    }

    /**
     * @notice startSim ~ endSim까지의 referralPool에 대한 유저가 받을 vesting양을 계산한다.
     * @param _user 보상을 계산할 추천인 주소
     * @param _startSim 시뮬레이션 시작 일 인덱스 (포함)
     * @param _endSim 시뮬레이션 종료 일 인덱스 (포함)
     * @return total 해당 구간의 총 예상 보상량 (18 decimals)
     * @dev 
     * - 구매자 풀과 동일한 로직으로 추천인 풀 보상 계산
     * - 체크포인트 기반으로 정확한 추천량 변화 추적
     * - 분모는 전일까지의 누적 추천량 사용
     */
    function _previewRefPendingAt(address _user, uint256 _startSim, uint256 _endSim) internal view returns (uint256 total) {
        BoxAmountCheckpoint[] storage hist = referralAmountHistory[_user];
        uint256 n = hist.length;

        uint256 i = 0; uint256 curBal = 0;
        while (i < n && hist[i].day <= _startSim) { curBal = hist[i].amount; unchecked { i++; } }

        uint256 prevRefs = (lastSyncedDay == 0) ? 0 : cumReferals[lastSyncedDay - 1];
        if (_startSim > lastSyncedDay) {
            for (uint256 dd = lastSyncedDay; dd < _startSim; dd++) {
                prevRefs += referralsAddedPerDay[dd];
            }
        }

        for (uint256 d = _startSim; d <= _endSim; d++) {
            while (i < n && hist[i].day <= d) { curBal = hist[i].amount; unchecked { i++; } }
            uint256 denom = prevRefs + referralsAddedPerDay[d];
            if (denom > 0 && curBal > 0) {
                uint256 dayStartTs = vestingStartDate + d * SECONDS_PER_DAY;
                uint256 pool = _dailyPoolRawByTs(dayStartTs, false);
                if (pool > 0) total += curBal * (pool / denom);
            }
            prevRefs += referralsAddedPerDay[d];
        }
    }

    /**
     * @notice 구매자 박스 보유량 체크포인트 추가 - 히스토리 관리
     * @param _user 체크포인트를 추가할 사용자 주소
     * @param _effDay 체크포인트가 효력을 발휘하는 날 (구매일)
     * @param _added 새로 추가된 박스 수량
     * @dev 
     * - 사용자별 박스 보유량 변화를 시간순으로 추적
     * - 새로운 체크포인트는 이전 누적량 + 추가량으로 계산
     * - 첫 번째 체크포인트인 경우 lastBuyerClaimedDay를 UNSET으로 초기화
     */
    function _pushBuyerCheckpoint(address _user, uint256 _effDay, uint256 _added) internal {
        BoxAmountCheckpoint[] storage hist = buyerBoxAmountHistory[_user];
        // 최초 진입 시 클레임 시작점 표식
        if (hist.length == 0 && lastBuyerClaimedDay[_user] == 0) {
            lastBuyerClaimedDay[_user] = UNSET;
        }
        if (hist.length != 0) {
            BoxAmountCheckpoint storage last = hist[hist.length - 1];
            
            if (last.day == _effDay) {
                // 같은 날이면 마지막 항목을 in-place로 누적 증가
                last.amount += _added;
                return;
            }
            require(_effDay > last.day, "non-monotonic effDay");
            hist.push(BoxAmountCheckpoint({
                day: _effDay,
                amount: last.amount + _added
            })); // 다음 날 이후면 누적값으로 새 체크포인트 추가
        } else {
            // 첫 체크포인트
            hist.push(BoxAmountCheckpoint({
                day: _effDay,
                amount: _added
            }));
        }
    }

    /**
     * @notice 추천인 레퍼럴 단위 보유량 체크포인트 추가 - 히스토리 관리
     * @param _user 체크포인트를 추가할 추천인 주소
     * @param _effDay 체크포인트가 효력을 발휘하는 날 (구매일)
     * @param _added 새로 추가된 레퍼럴 단위 수량
     * @dev 
     * - 사용자별 레퍼럴 단위 보유량 변화를 시간순으로 추적
     * - 새로운 체크포인트는 이전 누적량 + 추가량으로 계산
     * - 첫 번째 체크포인트인 경우 lastRefClaimedDay를 UNSET으로 초기화
     */
    function _pushRefCheckpoint(address _user, uint256 _effDay, uint256 _added) internal {
        BoxAmountCheckpoint[] storage hist = referralAmountHistory[_user];
        // 최초 진입 시 클레임 시작점 표식
        if (hist.length == 0 && lastRefClaimedDay[_user] == 0) {
            lastRefClaimedDay[_user] = UNSET;
        }
        if (hist.length != 0) {
            BoxAmountCheckpoint storage last = hist[hist.length - 1];
            if (last.day == _effDay) {
                last.amount += _added;
                return;
            }
            require(_effDay > last.day, "non-monotonic effDay");
            hist.push(BoxAmountCheckpoint({
                day: _effDay,
                amount: last.amount + _added
            })); // 다음 날 이후면 누적값으로 새 체크포인트 추가
        } else {
            hist.push(BoxAmountCheckpoint({
                day: _effDay,
                amount: _added
            }));
        }
    }

    /**
     * @notice 누적 배열에서 구간 합 계산 - prefix-sum 활용
     * @param _cum 누적값을 저장하는 매핑
     * @param _a 구간 시작 인덱스 (포함)
     * @param _b 구간 종료 인덱스 (포함)
     * @return s 구간 [a, b]의 합
     * @dev 
     * - cum[b] - cum[a-1]로 구간 [a, b]의 합 계산
     * - a > b인 경우 0 반환
     * - a == 0인 경우 cum[b] 반환 (0부터 b까지의 누적)
     */
    function _rangeSum(
        mapping(uint256 => uint256) storage _cum, 
        uint256 _a, 
        uint256 _b
    ) internal view returns (uint256 s) {
        if (_a > _b) return 0;
        if (_a == 0) return _cum[_b];
        return _cum[_b] - _cum[_a - 1];
    }

    /**
     * @notice 레퍼럴 코드 문자열로 추천인 주소와 정규화된 코드 조회
     * @param _refCodeStr 8자리 레퍼럴 코드 문자열
     * @return referrer 해당 코드의 소유자 주소
     * @return code 정규화된 bytes8 형태의 레퍼럴 코드
     * @dev 
     * - 입력된 문자열을 bytes8로 정규화 (대문자 변환, 유효성 검증)
     * - 정규화된 코드로 소유자 주소 조회
     * - 코드가 존재하지 않으면 revert
     */
    function _referrerFromString(string calldata _refCodeStr) internal view returns (address referrer, bytes8 code) {
        code = _normalizeToBytes8(_refCodeStr);
        referrer = codeToOwner[code];
        require(referrer != address(0), "referral code not found");
    }

    /**
     * @notice 레퍼럴 코드 설정의 내부 로직을 처리하는 함수
     * @param _user 레퍼럴 코드를 설정할 유저 주소
     * @param _code 설정할 레퍼럴 코드 (bytes8 형식)
     * @param _overwrite 기존 코드가 있을 때 덮어쓸지 여부
     * @dev 
     * - 내부 함수로 외부에서 직접 호출 불가
     * - 유저 주소와 코드가 유효한지 검증
     * - 코드 중복 할당 방지 (다른 유저가 이미 사용 중인 코드는 할당 불가)
     * - overwrite가 true인 경우에만 기존 코드 덮어쓰기 가능
     * - 코드 할당 시 양방향 매핑 업데이트 (user → code, code → user)
     * - 코드 할당 완료 시 이벤트 발생
     */
    function _setReferralCodeInternal(
        address _user, 
        bytes8 _code, 
        bool _overwrite
    ) internal {
        require(_user != address(0), "zero user");
        require(_code != bytes8(0), "zero code");

        // 이 코드가 다른 주소에 이미 배정되어 있으면 불가
        address ownerOfCode = codeToOwner[_code];
        require(ownerOfCode == address(0) || ownerOfCode == _user, "code taken");

        bytes8 old = referralCodeOf[_user];
        if (old != bytes8(0) && old != _code) {
            require(_overwrite, "has code");
            // 기존 코드 소유권 해제
            codeToOwner[old] = address(0);
        }

        referralCodeOf[_user] = _code;
        codeToOwner[_code] = _user;

        emit ReferralCodeAssigned(_user, _code);
    }

    /**
     * @notice 하루치 베스팅 보상 확정 - 내부 동기화 로직
     * @notice 이 함수는 sync() 내부에서 호출되어 자동으로 처리됨
     * @dev 
     * - 특정 하루의 구매자 풀과 추천인 풀 보상을 계산하고 확정
     * - 분모는 전일까지의 누적 보유량 (당일 추가분은 다음 날부터 반영)
     * - prefix-sum 방식으로 누적 보상 계산
     * - 일별 데이터와 누적 데이터 모두 업데이트
     */
    function _syncOneDay() internal {
        // [d]일의 자정(UTC 00:00) 타임스탬프
        uint256 dayStart = nextSyncTs;
        uint256 d = (dayStart - vestingStartDate) / SECONDS_PER_DAY;

        // ── 분모(denominator) 계산
        // 기본: 전일까지의 누적(cum[d-1])을 분모로 사용
        // 예외: 첫날(d==0)은 전일이 없으므로 "당일 추가분까지" 포함하여 분모 산정
        uint256 prevBoxes = (d == 0) ? 0 : cumBoxes[d - 1];
        uint256 prevRefs  = (d == 0) ? 0 : cumReferals[d - 1];

        uint256 boxesDenom    = prevBoxes + boxesAddedPerDay[d];
        uint256 referralDenom = prevRefs  + referralsAddedPerDay[d];

        // ── 해당 날짜의 일일 풀(18dec)
        uint256 buyerPool = _dailyPoolRawByTs(dayStart, true);
        uint256 refPool   = _dailyPoolRawByTs(dayStart, false);

        // ── 일일 단가(18dec)
        uint256 perBox = 0;
        if (buyerPool > 0 && boxesDenom > 0) {
            perBox = buyerPool / boxesDenom;
        }
        uint256 perRef = 0;
        if (refPool > 0 && referralDenom > 0) {
            perRef = refPool / referralDenom;
        }

        // ── 일별/누적 단가 기록
        rewardPerBox[d] = perBox;
        rewardPerReferral[d] = perRef;
        cumRewardPerBox[d] = (d == 0 ? 0 : cumRewardPerBox[d - 1]) + perBox;
        cumRewardPerReferral[d] = (d == 0 ? 0 : cumRewardPerReferral[d - 1]) + perRef;

        // ── 누적 수량 갱신(오늘 추가분 반영)
        cumBoxes[d]    = prevBoxes + boxesAddedPerDay[d];
        cumReferals[d] = prevRefs  + referralsAddedPerDay[d];

        // ── 이벤트
        emit DailySynced(d, perBox, perRef, boxesDenom, referralDenom);

        // ── 다음 날로 진행
        unchecked {
            nextSyncTs += SECONDS_PER_DAY;
            lastSyncedDay = d + 1; // "확정 완료한 총 일수"
        }
    }

    /**
     * @notice 해당 연차의 ‘일수’ (inclusive)
     * @param _y 입력된 연차
     * @return 입력된 연차의 전체 날짜 수
     */
    function _termDays(uint256 _y) internal view returns (uint256) {
        uint256 s = _yearStartTs(_y);
        uint256 e = _yearEndTs(_y);
        // e는 항상 s 이후이고, e가 exclusive (inclusive일 경우 +1 해야 함)
        return ((e - s) / SECONDS_PER_DAY) + 1; // 기존 시스템: return 364;
    }

    /**
     * @notice 사용자의 SBT 토큰 등급을 필요시 업그레이드하는 내부 함수 - 등급 상승
     * @param _user 등급을 업그레이드할 사용자 주소
     * @param _tokenId 사용자의 SBT 토큰 ID
     * @dev 
     * - BadgeSBT 컨트랙트가 설정되지 않았거나 tokenId가 0인 경우 무시
     * - 사용자의 누적 구매 박스 수량을 기준으로 등급 결정
     * - BadgeSBT 컨트랙트의 upgradeBadgeByCount 함수 호출하여 등급 업데이트
     * - 업그레이드 완료 후 현재 등급을 조회하여 BadgeSBTUpgraded 이벤트 발생
     * - 구매량 증가에 따른 자동 등급 상승 시스템
     */
    function _upgradeBadgeIfNeeded(address _user, uint256 _tokenId) internal {
        address sbtAddr = address(badgeSBT);
        if (sbtAddr == address(0) || _tokenId == 0 || sbtAddr.code.length == 0) {
            return;
        }
        uint256 total = totalBoughtBoxes[_user];
        badgeSBT.upgradeBadgeByCount(_tokenId, total);
        IBadgeSBT.Tier t = badgeSBT.currentTier(_tokenId);
        emit BadgeSBTUpgraded(_user, _tokenId, t, total);
    }

    /**
     * @notice 특정 연차의 종료 시각 조회
     * @param _y 연차 인덱스 (0부터 시작)
     * @return 해당 연차의 종료 시각 (inclusive, Unix timestamp)
     */
    function _yearEndTs(uint256 _y) internal view returns (uint256) {
        return poolEndTimes[_y]; // inclusive
    }

    /**
     * @notice 특정 연차의 시작 시각 계산
     * @param _y 연차 인덱스 (0부터 시작)
     * @return 해당 연차의 시작 시각 (Unix timestamp)
     */
    function _yearStartTs(uint256 _y) internal view returns (uint256) {
        if (_y == 0) return vestingStartDate;
        return poolEndTimes[_y - 1] + 1; // inclusive end 다음 초가 다음 연차 시작
    }

    /**
     * @notice 특정 시각이 속한 연차 인덱스 조회
     * @param _dayStartTs 기준 시각 (Unix timestamp)
     * @return 해당 시각이 속한 연차 인덱스 (0부터 시작)
     * @dev poolEndTimes 배열을 순회하며 해당 시각이 속한 연차를 찾음
     *      스케줄을 벗어난 경우 배열 길이 반환
     */
    function _yearByTs(uint256 _dayStartTs) internal view returns (uint256) {
        uint256 n = poolEndTimes.length;
        for (uint256 i = 0; i < n; i++) {
            if (_dayStartTs <= poolEndTimes[i]) {
                return i;
            }
        }
        return n; // beyond schedule
    }

    /**
     * @notice 메타트랜잭션의 실제 서명자 주소 반환
     * @return sender 메타트랜잭션을 서명한 실제 사용자 주소
     * @dev 
     * - Context와 ERC2771Context를 모두 상속받아 구현
     * - 일반 트랜잭션에서는 msg.sender 반환
     * - 메타트랜잭션에서는 서명된 데이터에서 추출된 서명자 주소 반환
     * - 메타트랜잭션의 보안을 위해 필수적인 함수
     */
    function _msgSender() internal view override(Context, ERC2771Context) returns (address sender) {
        return super._msgSender();
    }

    /**
     * @notice 메타트랜잭션의 실제 호출 데이터 반환
     * @return 메타트랜잭션의 원본 호출 데이터 (서명 제외)
     * @dev 
     * - Context와 ERC2771Context를 모두 상속받아 구현
     * - 일반 트랜잭션에서는 msg.data 반환
     * - 메타트랜잭션에서는 서명을 제외한 원본 데이터 반환
     * - 메타트랜잭션의 데이터 무결성 검증에 필수적인 함수
     */
    function _msgData() internal view override(Context, ERC2771Context) returns (bytes calldata) {
        return super._msgData();
    }

    /**
     * @notice ERC2771 컨텍스트 접미사 길이 반환
     * @return 20 ERC2771 메타트랜잭션에서 사용하는 접미사 길이 (20바이트)
     * @dev 
     * - ERC2771Context에서 요구하는 추상 함수 구현
     * - 메타트랜잭션의 서명자 주소를 추출하기 위한 접미사 길이
     * - 20바이트는 이더리움 주소의 길이와 일치
     */
    function _contextSuffixLength() internal pure override(Context, ERC2771Context) returns (uint256) {
        return 20;
    }
}
