// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @dev dfdfdfdf
 * fdfdfdfdfdf
 *
 * fdfdfdfdfd
 */
struct MapStorage {
    string currentLocation;
    mapping(string => mapping(string => bool)) hasPath; 
}

bytes32 constant MAP_STORAGE_POSITION = keccak256("libmap.map.storage");

/**
 * @dev dfdfdfdf
 * fdfdfdfdfdf
 *
 * fdfdfdfdfd
 */
library LibMap {

    /// @notice Adds the path `from -> to` to the set of known paths.
    function addPath(string memory from, string memory to) internal {
        // IMPLEMENT THIS
        mapStorage().hasPath[from][to] = true;
    }

    /// @notice If the path `currentLocation() -> to` is known, sets current location as `to` and returns true.
    /// If path is not known, returns false.
    function travel(string memory to) internal returns (bool) { 
        // IMPLEMENT THIS
        string memory location = currentLocation();
        if(mapStorage().hasPath[location][to]) {
            mapStorage().currentLocation = to;
            return true;
        }
        return false;
    }

    /// @notice Returns current location.
    /// Initially set to "harbor".
    function currentLocation() internal view returns (string memory) {
        // IMPLEMENT THIS
        string memory location = mapStorage().currentLocation;
        return (keccak256(abi.encode(location)) == keccak256(abi.encode("")))? (string("harbor")) : (location);
    }

    function mapStorage() private pure returns (MapStorage storage map) {
        bytes32 position = MAP_STORAGE_POSITION;
        assembly {
            map.slot := position
        }
    }

}
