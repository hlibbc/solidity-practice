// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IBadgeSBT {
    enum BurnAuth { IssuerOnly, OwnerOnly, Both, Neither }
    enum Tier { None, Goldfish, Gamulchi, Shark, Whale }

    function mint(address to, string calldata uri, BurnAuth auth) external returns (uint256 tokenId);
    function upgradeBadgeByCount(uint256 tokenId, uint256 totalBoxesPurchased) external;
    function currentTier(uint256 tokenId) external view returns (Tier);
}
