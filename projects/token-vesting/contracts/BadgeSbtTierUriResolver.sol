// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./interface/IBadgeSBT.sol";

/**
 * @title BadgeSbtTierUriResolver - SBT 등급별 URI 리졸버
 * @notice 
 *  - 지정된 BadgeSBT의 `currentTier(tokenId)`를 읽어 등급→URI 매핑 반환
 *  - 등급별 URI는 배치로 설정/수정(`setTierURIs`), Tier.None은 불가
 *  - 기본 URI 값들을 배포 시점에 미리 세팅
 * @dev 
 *  - 생성자에서 대상 SBT 주소 고정(0 주소 금지)
 *  - 조회 시 빈 URI는 revert로 방어
 */
contract BadgeSbtTierUriResolver is Ownable {
    // ---------------------------------------------------------------------
    // 상수: 초기 URI
    // ---------------------------------------------------------------------
    /**
     * 초기 기본 URI들(배포 직후 등급별 기본 메타데이터)
     * 필요시 `setTierURIs`로 교체 가능
     */
    string private constant URI_SPROUT        = "ipfs://.../sprout.json";       // Tier.Sprout
    string private constant URI_CLOUD         = "ipfs://.../cloud.json";        // Tier.Cloud
    string private constant URI_AIRPLANE      = "ipfs://.../airplane.json";     // Tier.Airplane
    string private constant URI_ROCKET        = "ipfs://.../rocket.json";       // Tier.Rocket
    string private constant URI_SPACESTATION  = "ipfs://.../sstation.json";     // Tier.SpaceStation
    string private constant URI_MOON          = "ipfs://.../moon.json";         // Tier.Moon

    // ---------------------------------------------------------------------
    // 상태
    // ---------------------------------------------------------------------
    /**
     * 대상 SBT 컨트랙트 주소(불변).
     * 배포 시 고정되어 이후 변경 불가.
     */
    address public immutable badgeSBT;

    /**
     * 등급(Tier enum을 uint8 캐스팅) → 완전한 URI 매핑
     * 예: 1 → ipfs://.../sprout.json
     */
    mapping(uint8 => string) private _tierUri;

    // ---------------------------------------------------------------------
    // 이벤트
    // ---------------------------------------------------------------------
    /**
     * 등급별 URI가 설정/수정될 때 방출되는 이벤트
     * @param tier  설정된 등급(uint8 캐스팅 값)
     * @param uri   설정된 메타데이터 URI
     */
    event TierUriSet(uint8 indexed tier, string uri);

    // ---------------------------------------------------------------------
    // 생성자
    // ---------------------------------------------------------------------
    constructor(address sbt) Ownable(msg.sender) {
        require(sbt != address(0), "Resolver: sbt addr zero");
        badgeSBT = sbt;

        // 배포 직후 기본 URI 세팅 (Tier.None 제외)
        _tierUri[uint8(IBadgeSBT.Tier.Sprout)]       = URI_SPROUT;
        _tierUri[uint8(IBadgeSBT.Tier.Cloud)]        = URI_CLOUD;
        _tierUri[uint8(IBadgeSBT.Tier.Airplane)]     = URI_AIRPLANE;
        _tierUri[uint8(IBadgeSBT.Tier.Rocket)]       = URI_ROCKET;
        _tierUri[uint8(IBadgeSBT.Tier.SpaceStation)] = URI_SPACESTATION;
        _tierUri[uint8(IBadgeSBT.Tier.Moon)]         = URI_MOON;
    }

    // ---------------------------------------------------------------------
    // 관리 함수
    // ---------------------------------------------------------------------

    /**
     * @notice 등급별 URI 일괄 설정/수정 (Tier.None은 불가)
     * @param tiers 등급 배열 (IBadgeSBT.Tier)
     * @param uris  각 등급에 대응하는 완전한 URI(ipfs:// 또는 https://)
     * @dev
     *  - `onlyOwner` 보호
     *  - 입력 길이 일치 검증 및 빈 문자열 금지
     *  - 설정/수정 시마다 `TierUriSet` 이벤트 발생
     */
    function setTierURIs(IBadgeSBT.Tier[] calldata tiers, string[] calldata uris) external onlyOwner {
        uint256 n = tiers.length;
        require(n == uris.length, "Resolver: length mismatch");
        for (uint256 i = 0; i < n; i++) {
            uint8 t = uint8(tiers[i]);
            require(t >= uint8(IBadgeSBT.Tier.Sprout) && t <= uint8(IBadgeSBT.Tier.Moon), "Resolver: invalid tier");
            string calldata u = uris[i];
            require(bytes(u).length != 0, "Resolver: empty uri");

            _tierUri[t] = u;
            emit TierUriSet(t, u);
        }
    }

    /**
     * @notice 단일 등급 URI 조회(보조)
     * @dev 주로 관리/검증용. 프론트에서는 통상 `tokenURI`를 사용
     */
    function tierURI(IBadgeSBT.Tier tier) external view returns (string memory) {
        uint8 t = uint8(tier);
        require(t >= uint8(IBadgeSBT.Tier.Sprout) && t <= uint8(IBadgeSBT.Tier.Moon), "Resolver: invalid tier");
        return _tierUri[t];
    }

    // ---------------------------------------------------------------------
    // 표준 tokenURI
    // ---------------------------------------------------------------------

    /**
     * @notice 표준 시그니처. tokenId의 현재 등급을 읽어 매핑된 URI 반환
     * @dev 
     *  - SBT의 `currentTier(tokenId)` 결과(enum)를 uint8로 캐스팅하여 내부 매핑을 조회
     *  - `Tier.None(0)`은 허용하지 않으며, 미설정 URI에 대해서는 조회 실패 처리
     *  - 반환값은 ipfs:// 또는 https:// 형태의 완전한 URI여야 함
     */
    function tokenURI(uint256 tokenId) external view returns (string memory) {
        IBadgeSBT.Tier tierEnum = IBadgeSBT(badgeSBT).currentTier(tokenId);
        uint8 t = uint8(tierEnum);

        // 범위 체크: None(0) 불가, Moon(6)까지 허용
        require(t >= uint8(IBadgeSBT.Tier.Sprout) && t <= uint8(IBadgeSBT.Tier.Moon), "Resolver: invalid tier from SBT");

        string memory u = _tierUri[t];
        require(bytes(u).length != 0, "Resolver: uri not set");
        return u;
    }
}
