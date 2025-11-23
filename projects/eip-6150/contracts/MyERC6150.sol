// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MyERC6150 (OpenZeppelin v5.x 호환)
 * @notice
 *  - ERC-721을 기반으로 ERC-6150 계층형 NFT(Core + Enumerable + Burnable + ParentTransferable + AccessControl 뷰)를 구현합니다.
 *  - 트리 구조(루트/부모/자식/리프)를 유지하면서, 루트/자식 발행, 부모 변경, 리프 소각, 접근 제어(토큰별 관리자) 기능을 제공합니다.
 * @dev
 *  - OZ v5.x의 내부 API에 맞춘 래퍼 함수를 포함합니다(`_exists6150`, `_isApprovedOrOwner6150`).
 *  - 저장소 설계: `_parent`, `_children`, `_childIndex`로 계층 구조를 추적합니다.
 *  - 이벤트: 인터페이스에 정의된 `Minted`, `ParentTransferred`를 사용해 상위 호환을 유지합니다.
 *
 *  [설계]
 *  - Core: 부모/자식/루트/리프 관계를 유지하는 기본 뷰를 제공합니다.
 *  - Enumerable: 특정 부모 하위의 자식 개수/인덱스 접근을 제공합니다.
 *  - Burnable: 리프 토큰만 안전하게 소각할 수 있습니다(연결 정리 포함).
 *  - ParentTransferable: 부모 변경(루트 승격 포함) 기능을 제공합니다.
 *  - AccessControl(뷰): 토큰별 관리자 권한 조회, 발행/소각 가능 여부 조회를 제공합니다.
 *
 *  [사용법]
 *  - 루트 발행: `mintRoot(to)` (컨트랙트 소유자 또는 허용된 루트 민터만)
 *  - 자식 발행: `mintChild(to, parentId)` (해당 부모의 소유자 또는 관리자만)
 *  - 부모 변경: `transferParent(newParentId, tokenId)` (권한 필요, 순환/자기부모 금지)
 *  - 소각: `safeBurn(tokenId)` 또는 `safeBatchBurn(tokenIds)` (리프만 허용)
 *
 *  [권한]
 *  - 루트 발행 권한은 컨트랙트 소유자 또는 `setRootMinter`로 허용된 계정에 부여됩니다.
 *  - 특정 토큰의 관리자 권한은 토큰 소유자 또는 컨트랙트 소유자가 `setTokenAdmin`으로 위임할 수 있습니다.
 *
 *  [보안]
 *  - 부모 변경 시 순환 참조 방지(`_isDescendant`), 자기 자신을 부모로 지정 금지, 존재성 검사를 수행합니다.
 *  - 소각은 리프에 한정되며, 권한 검사를 통해 안전하게 처리됩니다.
 *
 *  [가스/제한]
 *  - 자식 목록 `_children[parent]`은 동적 배열로, 빈번한 삽입/삭제 시 가스 비용이 증가할 수 있습니다.
 *  - 삭제는 스왑-팝을 사용하여 O(1)로 처리하지만, 자식의 순서는 보장되지 않습니다.
 */

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "./interfaces/IERC6150.sol";
import "./interfaces/IERC6150Enumerable.sol";
import "./interfaces/IERC6150Burnable.sol";
import "./interfaces/IERC6150ParentTransferable.sol";
import "./interfaces/IERC6150AccessControl.sol";

contract MyERC6150 is
    ERC721,
    Ownable,
    IERC6150,
    IERC6150Enumerable,
    IERC6150Burnable,
    IERC6150ParentTransferable,
    IERC6150AccessControl
{
    // ── Storage ────────────────────────────────────────────────────────────────
    uint256 private _nextId = 1;                         // tokenId starts at 1
    mapping(uint256 => uint256) private _parent;         // child => parent (0 => root)
    mapping(uint256 => uint256[]) private _children;     // parent => children[]
    mapping(uint256 => uint256) private _childIndex;     // child => index in parent's children[]

    // Per-token admin
    mapping(uint256 => mapping(address => bool)) private _tokenAdmins;

    // Root mint 권한(루트 발행 허용 계정)
    mapping(address => bool) private _rootMinters;

    // ── Constructor ───────────────────────────────────────────────────────────
    /**
     * @notice 이름/심볼을 지정해 컨트랙트를 초기화합니다.
     * @param name_ 컬렉션 이름
     * @param symbol_ 컬렉션 심볼
     */
    constructor(string memory name_, string memory symbol_) ERC721(name_, symbol_) Ownable(msg.sender) {}

    // ── OZ v5 호환 래퍼 ──────────────────────────────────────────────────────
    // v4의 _exists 대체
    /**
     * @notice 토큰 존재 여부를 확인합니다(OZ v5 호환 래퍼).
     * @param tokenId 확인할 토큰 ID
     * @return exists 존재하면 true
     */
    function _exists6150(uint256 tokenId) internal view returns (bool) {
        return _ownerOf(tokenId) != address(0);
    }

    // v4의 _isApprovedOrOwner 대체
    /**
     * @notice `spender`가 `tokenId`에 대해 승인/소유 권한이 있는지 확인합니다(OZ v5 호환 래퍼).
     * @param spender 검사할 주소
     * @param tokenId 토큰 ID
     * @return authorized 권한이 있으면 true
     */
    function _isApprovedOrOwner6150(address spender, uint256 tokenId) internal view returns (bool) {
        address owner = ownerOf(tokenId); // _requireOwned 포함하지 않음: 호출부에서 검사
        return _isAuthorized(owner, spender, tokenId);
    }

    // ── Minting ───────────────────────────────────────────────────────────────
    /**
     * @notice 루트 토큰을 발행합니다.
     * @dev
     *  - 누구나 루트(창작물의 리비전1)를 발행할 수 있습니다.
     * @param to 수령자 주소
     * @return tokenId 발행된 루트 토큰 ID
     */
    function mintRoot(address to) external returns (uint256 tokenId) {
        tokenId = _mintWithParent(to, 0);
    }

    /**
     * @notice 부모 `parentId` 하위에 자식 토큰을 발행합니다.
     * @dev
     *  - 권한: `canMintChildren(parentId, msg.sender)`를 만족해야 합니다.
     *  - Revert:
     *    - "Parent not exist": `parentId`가 존재하지 않음
     *    - "Not allowed to mint child": 호출자 권한 없음
     * @param to 수령자 주소
     * @param parentId 부모 토큰 ID(존재해야 함)
     * @return tokenId 발행된 자식 토큰 ID
     */
    function mintChild(address to, uint256 parentId) external returns (uint256 tokenId) {
        require(_exists6150(parentId), "Parent not exist");
        require(canMintChildren(parentId, _msgSender()), "Not allowed to mint child");
        tokenId = _mintWithParent(to, parentId);
    }

    // ── Burn (leaf only) ─────────────────────────────────────────────────────
    // 1) 내부 헬퍼 추가
    /**
     * @notice 내부 소각 로직(리프만 허용). 권한/리프 검사를 수행하고 연결을 해제합니다.
     * @dev
     *  - Revert:
     *    - "Invalid token": 존재하지 않는 토큰
     *    - "Not a leaf": 리프가 아닌 토큰 소각 시도
     *    - "Not authorized to burn": 권한 없음
     * @param actor 소각 행위자(권한 검사 대상)
     * @param tokenId 소각할 토큰 ID
     */
    function _safeBurnInternal(address actor, uint256 tokenId) internal {
        _requireLeaf(tokenId);
        require(
            _isApprovedOrOwner6150(actor, tokenId) || _isAdmin(tokenId, actor),
            "Not authorized to burn"
        );

        uint256 p = _parent[tokenId];
        if (p != 0) {
            _removeFromChildren(p, tokenId);
        }
        _burn(tokenId);
        delete _parent[tokenId];
        delete _childIndex[tokenId];
    }

    // 2) 외부 단건 소각은 내부 헬퍼를 호출
    /**
     * @notice 리프 토큰을 안전하게 소각합니다.
     * @param tokenId 소각할 토큰 ID
     */
    function safeBurn(uint256 tokenId) external override {
        _safeBurnInternal(_msgSender(), tokenId);
    }

    // 3) 외부 배치 소각도 내부 헬퍼를 호출
    /**
     * @notice 여러 리프 토큰을 일괄 소각합니다.
     * @param tokenIds 소각할 토큰 ID 배열
     */
    function safeBatchBurn(uint256[] memory tokenIds) external override {
        address actor = _msgSender();
        for (uint256 i = 0; i < tokenIds.length; i++) {
            _safeBurnInternal(actor, tokenIds[i]);
        }
    }

    // ── Parent Transfer ───────────────────────────────────────────────────────
    /**
     * @notice `tokenId`의 부모를 `newParentId`로 변경합니다(0 허용=루트 승격).
     * @param newParentId 새로운 부모 토큰 ID(0 허용)
     * @param tokenId 대상 토큰 ID
     */
    function transferParent(uint256 newParentId, uint256 tokenId) external override {
        _transferParentInternal(newParentId, tokenId);
    }

    /**
     * @notice 여러 `tokenIds`의 부모를 `newParentId`로 일괄 변경합니다.
     * @param newParentId 새로운 부모 토큰 ID(0 허용)
     * @param tokenIds 대상 토큰 ID 배열
     */
    function batchTransferParent(uint256 newParentId, uint256[] memory tokenIds) external override {
        for (uint256 i = 0; i < tokenIds.length; i++) {
            _transferParentInternal(newParentId, tokenIds[i]);
        }
    }

    // ── Views (Core + Enumerable + AccessControl) ────────────────────────────
    /**
     * @notice `tokenId`의 부모 토큰을 반환합니다.
     * @param tokenId 부모를 조회할 토큰 ID
     * @return parentId 부모 토큰 ID(루트면 0)
     */
    function parentOf(uint256 tokenId) public view override returns (uint256 parentId) {
        require(_exists6150(tokenId), "Invalid token");
        return _parent[tokenId];
    }

    /**
     * @notice 부모 `tokenId` 하위의 자식 토큰 목록을 반환합니다.
     * @dev
     *  - `tokenId == 0`을 허용합니다. 이 경우 루트들의 자식 배열(`_children[0]`)을 반환합니다.
     *  - Revert:
     *    - "Invalid token": `tokenId != 0`이면서 존재하지 않는 경우
     * @param tokenId 부모 토큰 ID(0 허용: 루트들의 목록은 parentId=0에 매핑)
     * @return childrenIds 자식 토큰 ID 배열
     */
    function childrenOf(uint256 tokenId) public view override returns (uint256[] memory childrenIds) {
        require(tokenId == 0 || _exists6150(tokenId), "Invalid token");
        return _children[tokenId];
    }

    /**
     * @notice `tokenId`가 루트 토큰인지 여부를 반환합니다.
     * @param tokenId 확인할 토큰 ID
     * @return isRootToken 루트면 true
     */
    function isRoot(uint256 tokenId) public view override returns (bool) {
        require(_exists6150(tokenId), "Invalid token");
        return _parent[tokenId] == 0;
    }

    /**
     * @notice `tokenId`가 리프 토큰인지 여부를 반환합니다.
     * @param tokenId 확인할 토큰 ID
     * @return isLeafToken 리프면 true
     */
    function isLeaf(uint256 tokenId) public view override returns (bool) {
        require(_exists6150(tokenId), "Invalid token");
        return _children[tokenId].length == 0;
    }

    // Enumerable
    /**
     * @notice `parentId` 하위 자식(또는 루트) 개수를 반환합니다.
     * @param parentId 부모 토큰 ID(0 허용)
     * @return count 자식(또는 루트) 수
     */
    function childrenCountOf(uint256 parentId) external view override returns (uint256) {
        require(parentId == 0 || _exists6150(parentId), "Invalid token");
        return _children[parentId].length;
    }

    /**
     * @notice 부모 `parentId` 하위에서 `index` 위치의 자식 토큰 ID를 반환합니다.
     * @param parentId 부모 토큰 ID(0 허용)
     * @param index 0-based 인덱스
     * @return tokenId 해당 위치의 토큰 ID
     */
    function childOfParentByIndex(uint256 parentId, uint256 index) external view override returns (uint256) {
        require(parentId == 0 || _exists6150(parentId), "Invalid token");
        require(index < _children[parentId].length, "Index OOB");
        return _children[parentId][index];
    }

    /**
     * @notice `parentId` 하위에서 `tokenId`의 인덱스를 반환합니다.
     * @param parentId 부모 토큰 ID(0 허용)
     * @param tokenId 자식 토큰 ID
     * @return index 0-based 인덱스
     */
    function indexInChildrenEnumeration(uint256 parentId, uint256 tokenId) external view override returns (uint256) {
        require(_exists6150(tokenId), "Invalid token");
        require(_parent[tokenId] == parentId, "Not a child of parent");
        return _childIndex[tokenId];
    }

    // AccessControl (view only)
    /**
     * @notice `account`가 `tokenId`의 관리자(admin)인지 확인합니다.
     * @param tokenId 토큰 ID
     * @param account 계정 주소
     * @return isAdmin 관리자면 true
     */
    function isAdminOf(uint256 tokenId, address account) public view override returns (bool) {
        require(_exists6150(tokenId), "Invalid token");
        return _isAdmin(tokenId, account);
    }

    /**
     * @notice `account`가 `parentId` 하위에 자식 발행이 가능한지 확인합니다.
     * @dev `parentId`가 0이면 루트 발행 가능 여부를 의미합니다.
     * @param parentId 부모 토큰 ID(0 허용)
     * @param account 계정 주소
     * @return canMint 발행 가능하면 true
     */
    function canMintChildren(uint256 parentId, address account) public view override returns (bool) {
        require(_exists6150(parentId), "Invalid parent");
        uint256 rootId = _rootOf(parentId);
        return ownerOf(rootId) == account;
    }

    /**
     * @notice `account`가 `tokenId`를 소각할 수 있는지 확인합니다.
     * @param tokenId 토큰 ID
     * @param account 계정 주소
     * @return canBurn 소각 가능하면 true
     */
    function canBurnTokenByAccount(uint256 tokenId, address account) external view override returns (bool) {
        if (!_exists6150(tokenId)) return false;
        return _isApprovedOrOwner6150(account, tokenId) || _isAdmin(tokenId, account);
    }

    // ── Admin Utilities (project helper) ─────────────────────────────────────
    /**
     * @notice `account`의 루트 발행 권한을 설정합니다.
     * @param account 계정 주소
     * @param allowed 권한 허용 여부
     */
    function setRootMinter(address account, bool allowed) external onlyOwner {
        _rootMinters[account] = allowed;
    }

    /**
     * @notice 특정 `tokenId`에 대해 `account`의 관리자 권한을 설정합니다.
     * @dev
     *  - 권한: 토큰 소유자 또는 컨트랙트 소유자만 설정 가능
     *  - Revert:
     *    - "Invalid token": 존재하지 않는 토큰
     *    - "Not token/contract owner": 권한 없음
     * @param tokenId 토큰 ID(존재해야 함)
     * @param account 계정 주소
     * @param allowed 권한 허용 여부
     */
    function setTokenAdmin(uint256 tokenId, address account, bool allowed) external {
        require(_exists6150(tokenId), "Invalid token");
        require(ownerOf(tokenId) == _msgSender(), "Not token owner");
        _tokenAdmins[tokenId][account] = allowed;
    }

    // ── ERC165 ───────────────────────────────────────────────────────────────
    /**
     * @notice ERC-165 인터페이스 지원 여부를 반환합니다.
     * @param interfaceId 인터페이스 식별자
     * @return supported 지원하면 true
     */
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721)
        returns (bool)
    {
        return
            interfaceId == type(IERC6150).interfaceId ||
            interfaceId == type(IERC6150Enumerable).interfaceId ||
            interfaceId == type(IERC6150Burnable).interfaceId ||
            interfaceId == type(IERC6150ParentTransferable).interfaceId ||
            interfaceId == type(IERC6150AccessControl).interfaceId ||
            super.supportsInterface(interfaceId);
    }

    // ── Internal helpers ─────────────────────────────────────────────────────
    /**
     * @notice 내부 발행 로직: `parentId`를 설정하고 `Minted` 이벤트를 발생시킵니다.
     * @param to 수령자 주소
     * @param parentId 부모 토큰 ID(0 허용)
     * @return tokenId 발행된 토큰 ID
     */
    function _mintWithParent(address to, uint256 parentId) internal returns (uint256 tokenId) {
        tokenId = _nextId++;
        _safeMint(to, tokenId);

        _parent[tokenId] = parentId;
        _appendChild(parentId, tokenId);

        emit Minted(_msgSender(), to, parentId, tokenId);
    }

    /**
     * @notice 부모-자식 연결 배열에 토큰을 추가합니다.
     * @param parentId 부모 토큰 ID(0 허용)
     * @param tokenId 자식 토큰 ID
     */
    function _appendChild(uint256 parentId, uint256 tokenId) internal {
        _childIndex[tokenId] = _children[parentId].length;
        _children[parentId].push(tokenId);
    }

    /**
     * @notice 부모-자식 연결 배열에서 토큰을 제거합니다(스왑-팝).
     * @param parentId 부모 토큰 ID
     * @param tokenId 자식 토큰 ID
     */
    function _removeFromChildren(uint256 parentId, uint256 tokenId) internal {
        uint256 idx = _childIndex[tokenId];
        uint256 lastIdx = _children[parentId].length - 1;
        if (idx != lastIdx) {
            uint256 lastId = _children[parentId][lastIdx];
            _children[parentId][idx] = lastId;
            _childIndex[lastId] = idx;
        }
        _children[parentId].pop();
        delete _childIndex[tokenId];
    }

    /**
     * @notice 토큰이 리프인지 확인하고, 아니라면 revert합니다.
     * @param tokenId 점검할 토큰 ID
     */
    function _requireLeaf(uint256 tokenId) internal view {
        require(_exists6150(tokenId), "Invalid token");
        require(_children[tokenId].length == 0, "Not a leaf");
    }

    /**
     * @notice 토큰별 관리자 판단 로직(토큰 소유자, 컨트랙트 소유자, 등록된 관리자).
     * @param tokenId 토큰 ID
     * @param account 계정 주소
     * @return isAdmin 관리자면 true
     */
    function _isAdmin(uint256 tokenId, address account) internal view returns (bool) {
        return ownerOf(tokenId) == account || _tokenAdmins[tokenId][account];
    }

    /**
     * @notice 루트 발행 가능 여부(컨트랙트 소유자 또는 허용된 루트 민터).
     * @param account 계정 주소
     * @return allowed 루트 발행 가능하면 true
     */
    function _canMintRoot(address account) internal view returns (bool) {
        // Deprecated in ipkeepers: 루트 민트는 누구나 가능. 하위 호환을 위해 함수는 유지.
        return true;
    }

    /**
     * @notice `candidateId`가 `ancestorId`의 후손인지 여부를 검사합니다.
     * @param ancestorId 조상 토큰 ID
     * @param candidateId 후보 토큰 ID
     * @return isDescendant 후손이면 true
     */
    function _isDescendant(uint256 ancestorId, uint256 candidateId) internal view returns (bool) {
        uint256 p = _parent[candidateId];
        while (p != 0) {
            if (p == ancestorId) return true;
            p = _parent[p];
        }
        return false;
    }

    /**
     * @notice 주어진 토큰의 루트 조상 ID를 반환합니다.
     * @param tokenId 기준 토큰 ID
     * @return rootId 루트 토큰 ID
     */
    function _rootOf(uint256 tokenId) internal view returns (uint256 rootId) {
        require(_exists6150(tokenId), "Invalid token");
        uint256 current = tokenId;
        while (_parent[current] != 0) {
            current = _parent[current];
        }
        return current;
    }

    /**
     * @notice 부모 변경 내부 로직(권한/유효성/순환 방지 검증 포함).
     * @dev
     *  - 권한: 토큰 소유자/승인자 또는 해당 토큰의 관리자
     *  - Revert:
     *    - "Invalid token": 대상 토큰 미존재
     *    - "Not authorized": 권한 없음
     *    - "Same parent": 기존 부모와 동일
     *    - "New parent not exist": 새 부모 지정 시 존재하지 않음
     *    - "Cannot parent to self": 자기 자신을 부모로 지정
     *    - "Cannot move under descendant": 자신의 하위로 이동(순환) 시도
     * @param newParentId 새로운 부모 토큰 ID(0 허용)
     * @param tokenId 대상 토큰 ID
     */
    function _transferParentInternal(uint256 newParentId, uint256 tokenId) internal {
        require(_exists6150(tokenId), "Invalid token");
        require(
            _isApprovedOrOwner6150(_msgSender(), tokenId) || _isAdmin(tokenId, _msgSender()),
            "Not authorized"
        );

        uint256 oldParentId = _parent[tokenId];
        require(oldParentId != newParentId, "Same parent");

        if (newParentId != 0) {
            require(_exists6150(newParentId), "New parent not exist");
        }

        require(tokenId != newParentId, "Cannot parent to self");
        require(!_isDescendant(tokenId, newParentId), "Cannot move under descendant");

        _removeFromChildren(oldParentId, tokenId);
        _parent[tokenId] = newParentId;
        _appendChild(newParentId, tokenId);

        emit ParentTransferred(tokenId, oldParentId, newParentId);
    }
}
