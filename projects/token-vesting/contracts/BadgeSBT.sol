// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/interfaces/IERC4906.sol";
import "./interface/IBadgeSBT.sol";
import "./interface/IERC5192.sol";
import "./interface/IERC5484.sol";

interface ITokenUriResolverView {
    function tokenURI(uint256 tokenId) external view returns (string memory);
}

/**
 * @title BadgeSBT - 등급 기반 소울바운드 토큰
 * @notice 
 *  - 전송/승인 불가(SBT), 발급/소각만 허용
 *  - 등급(IBadgeSBT.Tier)에 따라 외부 Resolver가 tokenURI 제공
 *  - 관리자(admin)가 민트/업그레이드 수행, 소유자(owner)는 admin/resolver 관리
 * @dev 
 *  - EIP-5192 잠금, EIP-5484 발행/소각 규칙, ERC-4906 메타데이터 갱신 지원
 *  - 등급은 항상 비감소(다운그레이드 금지)
 *  - tokenURI는 Resolver 필수 설정, 미설정 시 revert
 */
contract BadgeSBT is ERC721, IERC5192, IERC5484, Ownable, IBadgeSBT {
    // ---------------- Errors ----------------
    error SBT_TransferNotAllowed();
    error SBT_ApprovalNotAllowed();
    error SBT_BurnNotAuthorized();
    error NotAdmin(address caller);
    error InvalidTier();
    error ResolverNotSet();

    // ---------------- Thresholds (누적 박스 수 기준) ----------------
    /**
     * @notice 등급 경계값(누적 박스 수)
     * @dev 아래 표는 _tierFromCount에서 사용
     *  - 0..4      → Sprout (기본)
     *  - 5..9      → Cloud
     *  - 10..19    → Airplane
     *  - 20..49    → Rocket
     *  - 50..99    → SpaceStation
     *  - 100+      → Moon
     */
    uint256 private constant TIER_SPROUT_MAX    = 5;    // 0..4 → Sprout, 5..9 → Cloud ...
    uint256 private constant TIER_CLOUD_MAX     = 10;
    uint256 private constant TIER_AIRPLANE_MAX  = 20;
    uint256 private constant TIER_ROCKET_MAX    = 50;
    uint256 private constant TIER_SSTATION_MAX  = 100;

    // ---------------- Events ----------------
    /**
     * @notice SBT의 등급이 상승했을 때 발생
     * @param tokenId 대상 토큰 ID
     * @param from    이전 등급
     * @param to      신규 등급
     */
    event BadgeUpgraded(uint256 indexed tokenId, IBadgeSBT.Tier from, IBadgeSBT.Tier to);

    /**
     * @notice Resolver 주소가 교체되었을 때 발생
     * @param prev 이전 Resolver 주소
     * @param next 신규 Resolver 주소
     */
    event ResolverChanged(address indexed prev, address indexed next);

    // ---------------- State ----------------
    /**
     * @notice 다음 발급될 토큰 ID(1부터 시작)
     */
    uint256 private _nextId = 1;

    /**
     * @notice 운영 관리자 주소(민트/업그레이드 권한)
     */
    address public admin;

    /**
     * @notice 총 발행량(현재 존재하는 SBT 총 개수)
     * @dev 민트 시 +1, 소각 시 -1
     */
    uint256 private _totalSupply;

    // Soulbound + 5484
    /**
     * @notice EIP-5192: 토큰 락 여부
     */
    mapping(uint256 => bool) private _locked;               // EIP-5192
    /**
     * @notice EIP-5484: 소각 권한 정책
     */
    mapping(uint256 => BurnAuth) private _burnAuth;         // EIP-5484
    /**
     * @notice EIP-5484: 발행자 주소 기록
     */
    mapping(uint256 => address)  private _issuer;

    // 현재 등급
    /**
     * @notice 현재 등급 기록
     */
    mapping(uint256 => IBadgeSBT.Tier) private _tierOf;

    // 외부 URI Resolver (tokenURI(uint256) 보유)
    /**
     * @notice 외부 tokenURI 리졸버(등급→URI 매핑 제공)
     */
    ITokenUriResolverView private _resolver;

    // ---------------- Modifiers ----------------
    /**
     * @notice admin 전용 제어자(민트/업그레이드)
     */
    modifier onlyAdmin() {
        if (admin != msg.sender) revert NotAdmin(msg.sender);
        _;
    }

    // ---------------- Constructor ----------------
    /**
     * @notice 생성자
     * @param _name 토큰 이름(ERC721)
     * @param _symbol 토큰 심볼(ERC721)
     * @param _admin 초기 admin 주소(민트/업그레이드 권한 보유)
     */
    constructor(string memory _name, string memory _symbol, address _admin)
        ERC721(_name, _symbol)
        Ownable(msg.sender)
    {
        admin = _admin;
    }

    // ---------------- Admin / Owner controls ----------------

    /**
     * @notice admin 지정을 변경 (onlyOwner)
     * @param _candidate 새 admin 주소 (zero 금지)
     */
    function setAdmin(address _candidate) external onlyOwner {
        require(_candidate != address(0), "Invalid args!");
        admin = _candidate;
    }

    /**
     * @notice Resolver 교체 (onlyOwner)
     * @dev    교체 즉시 ERC-4906 이벤트로 전체 메타데이터 갱신 신호 전파
     * @param newResolver 새 Resolver 컨트랙트 주소
     */
    function setResolver(address newResolver) external onlyOwner {
        address prev = address(_resolver);
        _resolver = ITokenUriResolverView(newResolver);
        emit ResolverChanged(prev, newResolver);

        if (_nextId > 1) {
            // 1..(마지막 발급된 토큰ID) 범위 갱신 알림
            emit IERC4906.BatchMetadataUpdate(1, _nextId - 1);
        }
    }

    /**
     * @notice 현재 설정된 Resolver 주소 조회
     * @return 현재 설정된 Resolver 컨트랙트 주소
     */
    function resolver() external view returns (address) {
        return address(_resolver);
    }

    // ---------------- IBadgeSBT: Mint / Upgrade / Query ----------------

    /**
     * @notice SBT 발행(민트) - admin 전용
     * @param to 수령자 주소
     * @param auth EIP-5484 BurnAuth 정책
     * @return tokenId 새로 발급된 토큰 ID
     */
    function mint(address to, BurnAuth auth)
        external
        onlyAdmin
        returns (uint256 tokenId)
    {
        tokenId = _nextId++;
        _safeMint(to, tokenId);

        _locked[tokenId]    = true;
        _burnAuth[tokenId]  = auth;
        _issuer[tokenId]    = _msgSender();
        _tierOf[tokenId]    = IBadgeSBT.Tier.Sprout;

        unchecked { _totalSupply += 1; }

        emit Locked(tokenId);                             // EIP-5192
        emit Issued(_issuer[tokenId], to, tokenId, auth); // EIP-5484
        emit IERC4906.MetadataUpdate(tokenId);            // 표시 메타데이터 갱신 통지
    }

    /**
     * @notice 누적 구매 박스 수에 근거한 자동 등급 업그레이드
     * @param tokenId 대상 토큰
     * @param totalBoxesPurchased 누적 구매 박스 수
     */
    function upgradeBadgeByCount(uint256 tokenId, uint256 totalBoxesPurchased) external onlyAdmin {
        _requireOwned(tokenId);
        IBadgeSBT.Tier newTier = _tierFromCount(totalBoxesPurchased);
        _upgradeBadge(tokenId, newTier);
    }

    /**
     * @notice 수동 등급 업그레이드(admin 권한)
     * @dev    등급 다운그레이드는 금지
     * @param tokenId 대상 토큰 ID
     * @param newTier 설정할 신규 등급
     */
    function upgradeBadge(uint256 tokenId, IBadgeSBT.Tier newTier) external onlyAdmin {
        _requireOwned(tokenId);
        if (newTier == IBadgeSBT.Tier.None || uint8(newTier) > uint8(IBadgeSBT.Tier.Moon)) {
            revert InvalidTier();
        }
        _upgradeBadge(tokenId, newTier);
    }

    /**
     * @notice 현재 등급 조회
     * @param tokenId 조회할 토큰 ID
     * @return 현재 등급(IBadgeSBT.Tier)
     */
    function currentTier(uint256 tokenId) external view returns (IBadgeSBT.Tier) {
        _requireOwned(tokenId);
        return _tierOf[tokenId];
    }

    // ---------------- Burn (EIP-5484 규칙) ----------------

    /**
     * @notice 소각(EIP-5484 규칙 준수)
     * @dev    BurnAuth 정책에 맞는 주체만 소각 가능
     * @param tokenId 소각할 토큰 ID
     */
    function burn(uint256 tokenId) external {
        address owner_ = ownerOf(tokenId);
        address issuer = _issuer[tokenId];
        BurnAuth auth  = _burnAuth[tokenId];

        if (auth == BurnAuth.IssuerOnly) {
            if (_msgSender() != issuer) revert SBT_BurnNotAuthorized();
        } else if (auth == BurnAuth.OwnerOnly) {
            if (_msgSender() != owner_) revert SBT_BurnNotAuthorized();
        } else if (auth == BurnAuth.Both) {
            if (_msgSender() != owner_ && _msgSender() != issuer) revert SBT_BurnNotAuthorized();
        } else {
            revert SBT_BurnNotAuthorized();
        }

        _burn(tokenId);

        unchecked { _totalSupply -= 1; }
    }

    // ---------------- EIP-5192 / EIP-5484 Views ----------------

    /**
     * @notice EIP-5192: 토큰 잠금 여부
     * @param tokenId 조회할 토큰 ID
     * @return 토큰이 잠금 상태인지 여부(true/false)
     */
    function locked(uint256 tokenId) external view override(IERC5192) returns (bool) {
        _requireOwned(tokenId);
        return _locked[tokenId];
    }

    /**
     * @notice EIP-5484: 소각 권한 정책 조회
     * @param tokenId 조회할 토큰 ID
     * @return BurnAuth 소각 권한 정책 값
     */
    function burnAuth(uint256 tokenId) external view override(IERC5484) returns (BurnAuth) {
        _requireOwned(tokenId);
        return _burnAuth[tokenId];
    }

    /**
     * @notice EIP-5484: 발행자 주소 조회
     * @param tokenId 조회할 토큰 ID
     * @return 발행자 주소
     */
    function issuerOf(uint256 tokenId) external view returns (address) {
        _requireOwned(tokenId);
        return _issuer[tokenId];
    }

    /**
     * @notice 현재 존재하는 SBT 총 개수(total supply)
     * @return 현재 총 발행량(소각 제외)
     */
    function totalSupply() external view returns (uint256) {
        return _totalSupply;
    }

    // ---------------- Internal: Tier Logic ----------------

    /**
     * @notice 내부 등급 갱신 로직(다운그레이드 금지)
     * @param tokenId 대상 토큰 ID
     * @param newTier 갱신할 신규 등급
     */
    function _upgradeBadge(uint256 tokenId, IBadgeSBT.Tier newTier) internal {
        IBadgeSBT.Tier old = _tierOf[tokenId];
        if (uint8(newTier) < uint8(old)) {
            revert InvalidTier();
        }
        _tierOf[tokenId] = newTier;

        emit IERC4906.MetadataUpdate(tokenId);    // Resolver 기반: tokenURI는 동적 반영
        emit BadgeUpgraded(tokenId, old, newTier);
    }

    /**
     * @notice 누적 박스 수 → 등급 맵핑
     * @param n 누적 구매 박스 수
     * @return 해당 수치에 대응하는 등급(IBadgeSBT.Tier)
     */
    function _tierFromCount(uint256 n) internal pure returns (IBadgeSBT.Tier) {
        if (n >= TIER_SSTATION_MAX) return IBadgeSBT.Tier.Moon;         // 100+
        if (n >= TIER_ROCKET_MAX)   return IBadgeSBT.Tier.SpaceStation;  // 50..99
        if (n >= TIER_AIRPLANE_MAX) return IBadgeSBT.Tier.Rocket;        // 20..49
        if (n >= TIER_CLOUD_MAX)    return IBadgeSBT.Tier.Airplane;      // 10..19
        if (n >= TIER_SPROUT_MAX)   return IBadgeSBT.Tier.Cloud;         // 5..9
        return IBadgeSBT.Tier.Sprout;                                     // 0..4
    }

    // ---------------- Soulbound: 전송/승인 차단 ----------------

    /**
     * @notice 전송/승인 전부 차단을 위한 핵심 훅 오버라이드
     * @dev    from!=0 && to!=0 (정상 전송) 상황을 검출해 즉시 revert
     * @param to 수신자 주소(민트/소각 아닌 경우 금지)
     * @param tokenId 토큰 ID
     * @param auth 호출자 주소(권한 판정용)
     * @return from 이전 소유자 주소(민트 시 0, 소각 시 기존 소유자)
     */
    function _update(address to, uint256 tokenId, address auth)
        internal
        override(ERC721)
        returns (address from)
    {
        from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) {
            revert SBT_TransferNotAllowed();
        }
        from = super._update(to, tokenId, auth);
        if (to == address(0)) {
            _cleanupTokenState(tokenId);
        }
        return from;
    }

    // 승인 관련도 차단(권장)
    function approve(address /*to*/, uint256 /*tokenId*/) public pure override {
        revert SBT_ApprovalNotAllowed();
    }
    function setApprovalForAll(address /*operator*/, bool /*approved*/) public pure override {
        revert SBT_ApprovalNotAllowed();
    }
    function getApproved(uint256 /*tokenId*/) public pure override returns (address) {
        return address(0);
    }
    function isApprovedForAll(address /*owner_*/, address /*operator*/) public pure override returns (bool) {
        return false;
    }

    /**
     * @notice 소각 시 토큰 관련 상태 정리
     * @param tokenId 정리할 토큰 ID
     */
    function _cleanupTokenState(uint256 tokenId) private {
        delete _locked[tokenId];
        delete _burnAuth[tokenId];
        delete _issuer[tokenId];
        delete _tierOf[tokenId];
    }

    // ---------------- tokenURI / ERC165 ----------------

    /**
     * @notice tokenURI 조회(Resolver 위임)
     * @dev Resolver가 반드시 설정되어 있어야 하며, 미설정 시 revert
     * @param tokenId 조회할 토큰 ID
     * @return 등급별 Resolver가 반환하는 메타데이터 URI
     */
    function tokenURI(uint256 tokenId)
        public
        view
        override 
        returns (string memory)
    {
        _requireOwned(tokenId);
        address r = address(_resolver);
        if (r == address(0)) revert ResolverNotSet();
        return _resolver.tokenURI(tokenId);
    }

    /**
     * @notice ERC165 인터페이스 지원 선언
     * @param interfaceId 조회할 인터페이스 ID(ERC165)
     * @return 지원 여부
     */
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override 
        returns (bool)
    {
        return
            super.supportsInterface(interfaceId) ||
            interfaceId == type(IERC5192).interfaceId || // 0xb45a3c0e
            interfaceId == type(IERC5484).interfaceId;   // 0x0489b56f
    }
}
