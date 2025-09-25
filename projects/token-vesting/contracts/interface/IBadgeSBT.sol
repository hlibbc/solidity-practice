// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IERC5484.sol";

interface IBadgeSBT {
    enum Tier { 
        None, 
        Sprout,
        Cloud,
        Airplane, 
        Rocket, 
        SpaceStation, 
        Moon
    }

    function mint(address to, IERC5484.BurnAuth auth) external returns (uint256 tokenId);
    function upgradeBadgeByCount(uint256 tokenId, uint256 totalBoxesPurchased) external;
    function currentTier(uint256 tokenId) external view returns (Tier);
}
