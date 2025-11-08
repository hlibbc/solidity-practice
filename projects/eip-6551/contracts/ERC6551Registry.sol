// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.4;

import "./interfaces/IERC6551Registry.sol";

/**
 * @title ERC6551Registry - EIP-6551 레지스트리 구현
 * @notice
 *  - 토큰 바운드 계정(Token Bound Account, TBA)의 주소 예측(`account`)과 생성(`createAccount`)을 담당합니다.
 *  - `CREATE2`를 사용하여 결정적 주소를 생성합니다. 동일한 입력(implementation, salt, chainId, tokenContract, tokenId)은 언제나 동일한 주소를 산출합니다.
 * @dev
 *  - 핵심 설계:
 *    - 단일 init-code 빌더(`_buildInitCode`)를 통해 예측/생성을 위한 바이트코드가 1바이트도 차이 없이 동일하도록 강제합니다.
 *    - 런타임 코드는 EIP-1167 minimal proxy(runtime) + 96바이트 footer(chainId, tokenContract, tokenId)로 구성됩니다.
 *    - 생성 코드는 위 런타임을 그대로 메모리에 복사/반환하는 간단한 프리픽스(creation prefix)를 사용합니다.
 *  - 보안/무결성:
 *    - `account()`로 미리 계산된 주소와 `createAccount()`로 실제 생성된 주소가 반드시 일치해야 합니다(테스트로 검증).
 *    - footer(96바이트)는 TBA가 스스로 자신의 소유 토큰 메타데이터를 안전하게 복원할 수 있도록 합니다.
 */
contract ERC6551Registry is IERC6551Registry {
    /**
     * @notice 주어진 매개변수로 TBA를 생성하거나, 이미 생성된 경우 해당 주소를 반환합니다.
     * @dev
     *  - `_buildInitCode`로 생성 코드를 구성하고, `CREATE2`로 배포합니다.
     *  - 이미 코드가 존재하면 재배포하지 않고 계산된 주소를 그대로 반환합니다.
     *  - 성공 시 `ERC6551AccountCreated` 이벤트를 발행합니다.
     * @param implementation 프록시가 위임 호출(delegatecall)할 구현 컨트랙트 주소
     * @param salt `CREATE2`용 솔트 값
     * @param chainId 대상 체인 ID(footer에 저장)
     * @param tokenContract 바인딩할 ERC721 컨트랙트 주소(footer에 저장)
     * @param tokenId 바인딩할 토큰 ID(footer에 저장)
     * @return predicted 생성되었거나 이미 존재하는 TBA 주소
     */
    function createAccount(
        address implementation,
        bytes32 salt,
        uint256 chainId,
        address tokenContract,
        uint256 tokenId
    ) external returns (address predicted) {
        bytes memory initCode = _buildInitCode(implementation, chainId, tokenContract, tokenId);
        predicted = _computeAddress(salt, initCode);
        if (predicted.code.length == 0) {
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

    /**
     * @notice 입력에 대응하는 TBA 주소를 `CREATE2` 공식으로 예측해 반환합니다.
     * @dev 배포 여부와 관계없이 주소 계산만 수행합니다.
     * @param implementation 프록시가 위임 호출할 구현 컨트랙트 주소
     * @param salt `CREATE2`용 솔트 값
     * @param chainId 대상 체인 ID(footer에 저장)
     * @param tokenContract 바인딩할 ERC721 컨트랙트 주소(footer에 저장)
     * @param tokenId 바인딩할 토큰 ID(footer에 저장)
     * @return 예측된 TBA 주소
     */
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
    /**
     * @notice EIP-1167 minimal proxy 런타임 + 96바이트 footer를 포함하는 생성 코드를 구성합니다.
     * @dev
     *  - runtime 구성:
     *    - prefix: `0x363d3d373d3d3d363d73`
     *    - implementation(20B)
     *    - suffix: `0x5af43d82803e903d91602b57fd5bf3`
     *    - footer(96B): `abi.encode(chainId, tokenContract, tokenId)`
     *  - creation prefix:
     *    - `60 <len> 60 0c 60 00 39 60 <len> 60 00 f3` 형식으로 런타임 전부를 복사/반환합니다.
     * @param implementation 프록시 대상 구현 컨트랙트 주소
     * @param chainId 체인 ID(footer)
     * @param tokenContract 토큰 컨트랙트 주소(footer)
     * @param tokenId 토큰 ID(footer)
     * @return 생성 코드(init-code)
     */
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

    /**
     * @notice `CREATE2` 주소 계산 공식을 사용해 주소를 예측합니다.
     * @dev `keccak256(0xff, deployer, salt, keccak256(initCode))`를 `uint160`으로 변환합니다.
     * @param salt `CREATE2`용 솔트 값
     * @param initCode 생성 코드(배포 시점에 전달되는 바이트코드)
     * @return 예측된 주소
     */
    function _computeAddress(bytes32 salt, bytes memory initCode) internal view returns (address) {
        bytes32 codeHash = keccak256(initCode);
        bytes32 data = keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, codeHash));
        return address(uint160(uint256(data)));
    }
}


