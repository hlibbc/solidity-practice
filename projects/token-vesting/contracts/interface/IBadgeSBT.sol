// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IBadgeSBT {
    enum BurnAuth { IssuerOnly, OwnerOnly, Both, Neither }
    enum Tier { 
        None, 
        Sprout,
        Cloud,
        Airplane, 
        Rocket, 
        SpaceStation, 
        Moon
    }

    function mint(address to, BurnAuth auth) external returns (uint256 tokenId);
    function upgradeBadgeByCount(uint256 tokenId, uint256 totalBoxesPurchased) external;
    function currentTier(uint256 tokenId) external view returns (Tier);
}
