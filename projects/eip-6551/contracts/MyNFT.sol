// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/**
 * @title MyNFT - EIP-6551 예제용 간단한 ERC721
 * @notice
 *  - TBA 귀속 실험을 위한 최소 기능의 NFT
 */
contract MyNFT is ERC721 {
    uint256 public nextId = 1;

    constructor() ERC721("MyNFT", "MNFT") {}

    /**
     * @notice 새 NFT를 발행합니다.
     * @param to 수신자 주소
     * @return id 발행된 토큰 ID
     */
    function mint(address to) external returns (uint256 id) {
        id = nextId++;
        _mint(to, id);
    }
}
