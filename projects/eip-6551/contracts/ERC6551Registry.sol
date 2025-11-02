// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.4;

import "./interfaces/IERC6551Registry.sol";

/**
 * @title ERC6551Registry - EIP-6551 레지스트리 구현
 * @notice
 *  - 토큰 바운드 계정(Token Bound Account, TBA)의 주소 예측(account)과 생성(createAccount)을 담당합니다.
 *  - CREATE2를 사용하여 결정적 주소를 생성합니다.
 * @dev
 *  - 단일 init-code 빌더를 사용해 account/createAccount가 동일 바이트열을 공유하도록 보장합니다.
 */
contract ERC6551Registry is IERC6551Registry {
    function createAccount(
        address implementation,
        bytes32 salt,
        uint256 chainId,
        address tokenContract,
        uint256 tokenId
    ) external returns (address account) {
        bytes memory initCode = _buildInitCode(implementation, chainId, tokenContract, tokenId);
        account = _computeAddress(salt, initCode);
        if (account.code.length == 0) {
            address deployed;
            assembly {
                let ptr := add(initCode, 0x20)
                let size := mload(initCode)
                deployed := create2(0, ptr, size, salt)
            }
            if (deployed == address(0)) revert AccountCreationFailed();
            emit ERC6551AccountCreated(deployed, implementation, salt, chainId, tokenContract, tokenId);
            return deployed;
        }
    }

    function account(
        address implementation,
        bytes32 salt,
        uint256 chainId,
        address tokenContract,
        uint256 tokenId
    ) external view returns (address) {
        bytes memory initCode = _buildInitCode(implementation, chainId, tokenContract, tokenId);
        return _computeAddress(salt, initCode);
    }

    // ----- internal helpers -----
    function _buildInitCode(
        address implementation,
        uint256 chainId,
        address tokenContract,
        uint256 tokenId
    ) internal pure returns (bytes memory) {
        // runtime: minimal proxy + footer(96 bytes)
        bytes memory runtime = abi.encodePacked(
            hex"363d3d373d3d3d363d73",
            implementation,
            hex"5af43d82803e903d91602b57fd5bf3",
            abi.encode(chainId, tokenContract, tokenId)
        );
        uint256 len = runtime.length;
        require(len < 256, "runtime too long");
        // creation: CODECOPY from offset 0x0c (12) to memory 0x00, then RETURN
        // 60 len | 60 0c | 60 00 | 39 | 60 len | 60 00 | f3
        bytes memory creation = abi.encodePacked(
            bytes1(0x60), bytes1(uint8(len)),
            bytes1(0x60), bytes1(0x0c),
            bytes1(0x60), bytes1(0x00),
            bytes1(0x39),
            bytes1(0x60), bytes1(uint8(len)),
            bytes1(0x60), bytes1(0x00),
            bytes1(0xf3),
            runtime
        );
        return creation;
    }

    function _computeAddress(bytes32 salt, bytes memory initCode) internal view returns (address) {
        bytes32 codeHash = keccak256(initCode);
        bytes32 data = keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, codeHash));
        return address(uint160(uint256(data)));
    }
}


