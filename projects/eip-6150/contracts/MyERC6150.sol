// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * MyERC6150 (OpenZeppelin v5.x 호환)
 * - ERC-721 기반으로 ERC-6150 계층형 NFT 구현
 * - Core + Enumerable + Burnable + ParentTransferable + AccessControl(뷰)
 *
 * Dependencies: OpenZeppelin v5.x
 *   - @openzeppelin/contracts/token/ERC721/ERC721.sol
 *   - @openzeppelin/contracts/access/Ownable.sol
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
    constructor(string memory name_, string memory symbol_) ERC721(name_, symbol_) Ownable(msg.sender) {}

    // ── OZ v5 호환 래퍼 ──────────────────────────────────────────────────────
    // v4의 _exists 대체
    function _exists6150(uint256 tokenId) internal view returns (bool) {
        return _ownerOf(tokenId) != address(0);
    }

    // v4의 _isApprovedOrOwner 대체
    function _isApprovedOrOwner6150(address spender, uint256 tokenId) internal view returns (bool) {
        address owner = ownerOf(tokenId); // _requireOwned 포함하지 않음: 호출부에서 검사
        return _isAuthorized(owner, spender, tokenId);
    }

    // ── Minting ───────────────────────────────────────────────────────────────
    function mintRoot(address to) external returns (uint256 tokenId) {
        require(_canMintRoot(_msgSender()), "Not allowed to mint root");
        tokenId = _mintWithParent(to, 0);
    }

    function mintChild(address to, uint256 parentId) external returns (uint256 tokenId) {
        require(_exists6150(parentId), "Parent not exist");
        require(canMintChildren(parentId, _msgSender()), "Not allowed to mint child");
        tokenId = _mintWithParent(to, parentId);
    }

    // ── Burn (leaf only) ─────────────────────────────────────────────────────
    // 1) 내부 헬퍼 추가
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
    function safeBurn(uint256 tokenId) external override {
        _safeBurnInternal(_msgSender(), tokenId);
    }

    // 3) 외부 배치 소각도 내부 헬퍼를 호출
    function safeBatchBurn(uint256[] memory tokenIds) external override {
        address actor = _msgSender();
        for (uint256 i = 0; i < tokenIds.length; i++) {
            _safeBurnInternal(actor, tokenIds[i]);
        }
    }

    // ── Parent Transfer ───────────────────────────────────────────────────────
    function transferParent(uint256 newParentId, uint256 tokenId) external override {
        _transferParentInternal(newParentId, tokenId);
    }

    function batchTransferParent(uint256 newParentId, uint256[] memory tokenIds) external override {
        for (uint256 i = 0; i < tokenIds.length; i++) {
            _transferParentInternal(newParentId, tokenIds[i]);
        }
    }

    // ── Views (Core + Enumerable + AccessControl) ────────────────────────────
    function parentOf(uint256 tokenId) public view override returns (uint256 parentId) {
        require(_exists6150(tokenId), "Invalid token");
        return _parent[tokenId];
    }

    function childrenOf(uint256 tokenId) public view override returns (uint256[] memory childrenIds) {
        require(tokenId == 0 || _exists6150(tokenId), "Invalid token");
        return _children[tokenId];
    }

    function isRoot(uint256 tokenId) public view override returns (bool) {
        require(_exists6150(tokenId), "Invalid token");
        return _parent[tokenId] == 0;
    }

    function isLeaf(uint256 tokenId) public view override returns (bool) {
        require(_exists6150(tokenId), "Invalid token");
        return _children[tokenId].length == 0;
    }

    // Enumerable
    function childrenCountOf(uint256 parentId) external view override returns (uint256) {
        require(parentId == 0 || _exists6150(parentId), "Invalid token");
        return _children[parentId].length;
    }

    function childOfParentByIndex(uint256 parentId, uint256 index) external view override returns (uint256) {
        require(parentId == 0 || _exists6150(parentId), "Invalid token");
        require(index < _children[parentId].length, "Index OOB");
        return _children[parentId][index];
    }

    function indexInChildrenEnumeration(uint256 parentId, uint256 tokenId) external view override returns (uint256) {
        require(_exists6150(tokenId), "Invalid token");
        require(_parent[tokenId] == parentId, "Not a child of parent");
        return _childIndex[tokenId];
    }

    // AccessControl (view only)
    function isAdminOf(uint256 tokenId, address account) public view override returns (bool) {
        require(_exists6150(tokenId), "Invalid token");
        return _isAdmin(tokenId, account);
    }

    function canMintChildren(uint256 parentId, address account) public view override returns (bool) {
        if (parentId == 0) {
            return _canMintRoot(account);
        }
        require(_exists6150(parentId), "Invalid parent");
        return _isAdmin(parentId, account) || ownerOf(parentId) == account;
    }

    function canBurnTokenByAccount(uint256 tokenId, address account) external view override returns (bool) {
        if (!_exists6150(tokenId)) return false;
        return _isApprovedOrOwner6150(account, tokenId) || _isAdmin(tokenId, account);
    }

    // ── Admin Utilities (project helper) ─────────────────────────────────────
    function setRootMinter(address account, bool allowed) external onlyOwner {
        _rootMinters[account] = allowed;
    }

    function setTokenAdmin(uint256 tokenId, address account, bool allowed) external {
        require(_exists6150(tokenId), "Invalid token");
        require(ownerOf(tokenId) == _msgSender() || owner() == _msgSender(), "Not token/contract owner");
        _tokenAdmins[tokenId][account] = allowed;
    }

    // ── ERC165 ───────────────────────────────────────────────────────────────
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
    function _mintWithParent(address to, uint256 parentId) internal returns (uint256 tokenId) {
        tokenId = _nextId++;
        _safeMint(to, tokenId);

        _parent[tokenId] = parentId;
        _appendChild(parentId, tokenId);

        emit Minted(_msgSender(), to, parentId, tokenId);
    }

    function _appendChild(uint256 parentId, uint256 tokenId) internal {
        _childIndex[tokenId] = _children[parentId].length;
        _children[parentId].push(tokenId);
    }

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

    function _requireLeaf(uint256 tokenId) internal view {
        require(_exists6150(tokenId), "Invalid token");
        require(_children[tokenId].length == 0, "Not a leaf");
    }

    function _isAdmin(uint256 tokenId, address account) internal view returns (bool) {
        return ownerOf(tokenId) == account || owner() == account || _tokenAdmins[tokenId][account];
    }

    function _canMintRoot(address account) internal view returns (bool) {
        return account == owner() || _rootMinters[account];
    }

    function _isDescendant(uint256 ancestorId, uint256 candidateId) internal view returns (bool) {
        uint256 p = _parent[candidateId];
        while (p != 0) {
            if (p == ancestorId) return true;
            p = _parent[p];
        }
        return false;
    }

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
