// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./interface/IERC5192.sol";
import "./interface/IERC5484.sol";

/**
 * @title BadgeSBT - 등급 기반 Soulbound Token
 * @notice 
 * - 비양도(transfer 불가), 민트/번만 허용하는 Soulbound Token
 * - 구매량에 따른 등급 시스템 (Sprout → Cloud → Airplane → Rocket → SpaceStation → Moon)
 * - EIP-5192: locked(tokenId)=true, mint 시 Locked 이벤트 발생
 * - EIP-5484: Issued 이벤트 & 토큰별 BurnAuth 고정
 * - 등급별 메타데이터 URI 자동 업데이트
 * @dev OpenZeppelin Contracts v5.x 기반
 */
contract BadgeSBT is ERC721URIStorage, IERC5192, IERC5484, Ownable {
    // def. Error
    error SBT_TransferNotAllowed();
    error SBT_ApprovalNotAllowed();
    error SBT_BurnNotAuthorized();
    error NotAdmin(address caller);
    error InvalidTier();

    // def. enum
    /**
     * @notice SBT 등급 정의 열거형 상수
     * @dev
     * - Sprout: 1 ~ 4
     * - Cloud: 5 ~ 9
     * - Airplane: 10 ~ 19
     * - Rocket: 20 ~ 49
     * - SpaceStation: 50 ~ 99
     * - Moon: 100 ~
     */
    enum Tier { 
        None, 
        Sprout,
        Cloud,
        Airplane, 
        Rocket, 
        SpaceStation, 
        Moon
    }

    // 등급 기준(개수)
    uint256 private constant TIER_SPROUT_MAX  = 5; 
    uint256 private constant TIER_CLOUD_MAX  = 10; 
    uint256 private constant TIER_AIRPLANE_MAX  = 20; 
    uint256 private constant TIER_ROCKET_MAX  = 50; 
    uint256 private constant TIER_SSTATION_MAX  = 100; 

    // 등급별 메타데이터 URI
    string private constant URI_SPROUT = "ipfs://.../sprout.json";
    string private constant URI_CLOUD = "ipfs://.../cloud.json";
    string private constant URI_AIRPLANE = "ipfs://.../airplane.json";
    string private constant URI_ROCKET = "ipfs://.../rocket.json";
    string private constant URI_SPACESTATION = "ipfs://.../sstation.json";
    string private constant URI_MOON = "ipfs://.../moon.json";

    // 이벤트(선택) — 업그레이드 추적용
    event BadgeUpgraded(uint256 indexed tokenId, Tier from, Tier to, string uri);

    // ===== State =====
    uint256 private _nextId = 1;
    address public admin;

    // EIP-5192: 잠금 상태(본 구현은 true 고정)
    mapping(uint256 => bool) private _locked;

    // EIP-5484: 소각 권한, 발행자
    mapping(uint256 => BurnAuth) private _burnAuth;
    mapping(uint256 => address)  private _issuer;

    // 토큰별 현재 등급(다운그레이드 방지 목적)
    mapping(uint256 => Tier)     private _tierOf;

    // ===== Modifiers =====
    modifier onlyAdmin() {
        if (admin != msg.sender) revert NotAdmin(msg.sender);
        _;
    }

    /**
     * @notice BadgeSBT 컨트랙트 생성자
     * @param _name 토큰 이름
     * @param _symbol 토큰 심볼
     * @param _admin 등급 업그레이드 권한을 가진 관리자 주소
     * @dev 
     * - ERC721과 Ownable 초기화
     * - admin은 등급 업그레이드와 민트 권한을 가짐
     */
    constructor(string memory _name, string memory _symbol, address _admin)
        ERC721(_name, _symbol)
        Ownable(msg.sender)
    {
        admin = _admin;
    }

    /**
     * @notice 관리자 주소 변경 - onlyOwner 전용
     * @param _candidate 새로운 관리자 후보 주소
     * @dev 
     * - 컨트랙트 소유자만 호출 가능
     * - 0 주소는 허용하지 않음
     * - 등급 업그레이드와 민트 권한이 이전됨
     */
    function setAdmin(address _candidate) external onlyOwner {
        require(_candidate != address(0), "Invalid args!");
        admin = _candidate;
    }

    /**
     * @notice SBT 발행(민트) - admin 전용, 이후 전송 불가
     * @param to 토큰 수취자 주소
     * @param auth 소각 권한 설정 (EIP-5484)
     * @return tokenId 발행된 토큰의 ID
     * @dev 
     * - onlyAdmin만 호출 가능
     * - 토큰은 영구 잠금 상태로 설정
     * - 초기 등급은 Tier.None으로 설정
     * - EIP-5192와 EIP-5484 이벤트 발생
     */
    function mint(address to, BurnAuth auth)
        external
        onlyAdmin
        returns (uint256 tokenId)
    {
        tokenId = _nextId++;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, URI_SPROUT);

        _locked[tokenId]    = true;
        _burnAuth[tokenId]  = auth;
        _issuer[tokenId]    = _msgSender();
        _tierOf[tokenId]    = Tier.Sprout; // 초기 등급(없음)

        emit Locked(tokenId); // EIP-5192
        emit Issued(_issuer[tokenId], to, tokenId, auth); // EIP-5484
    }

    /**
     * @notice SBT 소각 - BurnAuth 규칙에 따른 권한 검증
     * @param tokenId 소각할 토큰의 ID
     * @dev 
     * - EIP-5484의 BurnAuth 규칙을 엄격히 적용
     * - IssuerOnly: 발행자만 소각 가능
     * - OwnerOnly: 소유자만 소각 가능
     * - Both: 발행자와 소유자 모두 소각 가능
     * - Neither: 아무도 소각 불가
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
    }

    /**
     * @notice EIP-5192: 토큰의 잠금 상태 조회
     * @param tokenId 조회할 토큰의 ID
     * @return true (항상 잠금 상태)
     * @dev 
     * - IERC5192 인터페이스 구현
     * - 본 구현에서는 모든 토큰이 영구 잠금 상태
     */
    function locked(uint256 tokenId) external view override(IERC5192) returns (bool) {
        _requireOwned(tokenId);
        return _locked[tokenId];
    }

    /**
     * @notice EIP-5484: 토큰의 소각 권한 조회
     * @param tokenId 조회할 토큰의 ID
     * @return 해당 토큰의 소각 권한 설정
     * @dev 
     * - IERC5484 인터페이스 구현
     * - 민트 시점에 설정된 권한을 반환
     */
    function burnAuth(uint256 tokenId) external view override(IERC5484) returns (BurnAuth) {
        _requireOwned(tokenId);
        return _burnAuth[tokenId];
    }

    /**
     * @notice 토큰 발행자 주소 조회
     * @param tokenId 조회할 토큰의 ID
     * @return 해당 토큰을 발행한 주소
     * @dev 
     * - EIP-5484의 발행자 정보 제공
     * - 소각 권한 검증에 사용
     */
    function issuerOf(uint256 tokenId) external view returns (address) {
        _requireOwned(tokenId);
        return _issuer[tokenId];
    }

    /**
     * @notice 토큰의 현재 등급 조회
     * @param tokenId 조회할 토큰의 ID
     * @return 해당 토큰의 현재 등급
     * @dev 
     * - 등급은 구매량에 따라 자동 업그레이드
     * - 다운그레이드는 불가능
     */
    function currentTier(uint256 tokenId) external view returns (Tier) {
        _requireOwned(tokenId);
        return _tierOf[tokenId];
    }

    /**
     * @notice 구매량 기반 자동 등급 업그레이드 - admin 전용
     * @param tokenId 업그레이드할 토큰의 ID
     * @param totalBoxesPurchased 누적 구매 박스 수량
     * @dev 
     * - onlyAdmin만 호출 가능
     * - 구매량에 따라 자동으로 등급 산정
     * - 다운그레이드 방지 로직 적용
     */
    function upgradeBadgeByCount(uint256 tokenId, uint256 totalBoxesPurchased) external onlyAdmin {
        _requireOwned(tokenId);
        Tier newTier = _tierFromCount(totalBoxesPurchased);
        _upgradeBadge(tokenId, newTier);
    }

    /**
     * @notice 직접 등급 지정 업그레이드 - admin 전용
     * @param tokenId 업그레이드할 토큰의 ID
     * @param newTier 설정할 새로운 등급
     * @dev 
     * - onlyAdmin만 호출 가능
     * - 유효한 등급 범위 검증
     * - 다운그레이드 방지 로직 적용
     */
    function upgradeBadge(uint256 tokenId, Tier newTier) external onlyAdmin {
        _requireOwned(tokenId);
        if (newTier == Tier.None || uint8(newTier) > uint8(Tier.Moon)) {
            revert InvalidTier();
        }
        _upgradeBadge(tokenId, newTier);
    }

    /**
     * @notice 내부 등급 업그레이드 로직 - 다운그레이드 방지
     * @param tokenId 업그레이드할 토큰의 ID
     * @param newTier 설정할 새로운 등급
     * @dev 
     * - 다운그레이드 방지 로직 적용
     * - 등급별 메타데이터 URI 자동 업데이트
     * - ERC4906 MetadataUpdate 이벤트 자동 발생 (OZ v5)
     * - BadgeUpgraded 이벤트 발생
     */
    function _upgradeBadge(uint256 tokenId, Tier newTier) internal {
        Tier old = _tierOf[tokenId];
        // 다운그레이드 방지
        if (uint8(newTier) < uint8(old)) {
            revert InvalidTier();
        }
        string memory newUri = _uriForTier(newTier);
        _tierOf[tokenId] = newTier;
        _setTokenURI(tokenId, newUri); // ERC4906의 MetadataUpdate 이벤트가 내부에서 발생(OZ v5)

        emit BadgeUpgraded(tokenId, old, newTier, newUri);
    }

    /**
     * @notice 구매 박스 수량에 따른 등급 산정
     * @param n 누적 구매 박스 수량
     * @return 해당 수량에 맞는 등급
     * @dev 
     * - Sprout: 1 ~ 4
     * - Cloud: 5 ~ 9
     * - Airplane: 10 ~ 19
     * - Rocket: 20 ~ 49
     * - SpaceStation: 50 ~ 99
     * - Moon: 100 ~
     */
    function _tierFromCount(uint256 n) internal pure returns (Tier) {
        if (n >= TIER_SSTATION_MAX) { // 100+
            return Tier.Moon;
        }
        if (n >= TIER_ROCKET_MAX) { // 50..99
            return Tier.SpaceStation;
        }
        if (n >= TIER_AIRPLANE_MAX) { // 20..49
            return Tier.Rocket;
        }
        if (n >= TIER_CLOUD_MAX) { // 10..19
            return Tier.Airplane;
        }
        if (n >= TIER_SPROUT_MAX) { // 5..9
            return Tier.Cloud;
        }
        return Tier.Sprout; // 0..4 (문서상 1..4이지만 0은 실사용상 없거나 첫 민팅 직후)
    }


    /**
     * @notice 등급별 메타데이터 URI 반환
     * @param t 조회할 등급
     * @return 해당 등급의 메타데이터 URI
     * @dev 
     * - 각 등급별로 고정된 URI 반환
     * - 유효하지 않은 등급인 경우 revert
     * - URI는 상수로 하드코딩되어 있음
     */
    function _uriForTier(Tier t) internal pure returns (string memory) {
        if (t == Tier.Sprout) {
            return URI_SPROUT;
        }
        if (t == Tier.Cloud) {
            return URI_CLOUD;
        }
        if (t == Tier.Airplane) {
            return URI_AIRPLANE;
        }
        if (t == Tier.Rocket) {
            return URI_ROCKET;
        }
        if (t == Tier.SpaceStation) {
            return URI_SPACESTATION;
        }
        if (t == Tier.Moon) {
            return URI_MOON;
        }
        revert InvalidTier();
    }

    // =========================
    // Soulbound: 전송/승인 차단
    // =========================

    /**
     * @notice OpenZeppelin v5 단일 훅 - 전송 차단 로직
     * @param to 토큰을 받을 주소
     * @param tokenId 전송할 토큰의 ID
     * @param auth 인증된 주소
     * @return from 업데이트된 주소
     * @dev 
     * - OZ v5: _before/_afterTokenTransfer 대신 단일 훅 `_update` 사용
     * - mint: from == address(0) 허용
     * - burn: to == address(0) 허용
     * - transfer: from != 0 && to != 0 차단 (Soulbound)
     * - 주의: mint/burn 경로에서 ownerOf()는 revert 하므로 _ownerOf() 사용
     */
    function _update(address to, uint256 tokenId, address auth)
        internal
        override(ERC721)
        returns (address from)
    {
        // 주의: mint/burn 경로에서 ownerOf()는 revert 하므로 _ownerOf() 사용
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

    function _cleanupTokenState(uint256 tokenId) private {
        delete _locked[tokenId];
        delete _burnAuth[tokenId];
        delete _issuer[tokenId];
        delete _tierOf[tokenId];
    }

    // =========================
    // ERC-721 / URIStorage / ERC165
    // =========================

    /**
     * @notice 토큰의 메타데이터 URI 조회
     * @param tokenId 조회할 토큰의 ID
     * @return 해당 토큰의 메타데이터 URI
     * @dev 
     * - ERC721URIStorage의 tokenURI 함수 호출
     * - 등급 업그레이드 시 URI가 자동으로 변경됨
     */
    function tokenURI(uint256 tokenId)
        public
        view
        override 
        returns (string memory)
    {
        return ERC721URIStorage.tokenURI(tokenId);
    }

    /**
     * @notice ERC-165 인터페이스 지원 여부 조회
     * @param interfaceId 조회할 인터페이스 ID
     * @return 해당 인터페이스를 지원하면 true
     * @dev 
     * - ERC721 기본 인터페이스 지원
     * - IERC5192 (EIP-5192) 인터페이스 지원: 0xb45a3c0e
     * - IERC5484 (EIP-5484) 인터페이스 지원: 0x0489b56f
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
