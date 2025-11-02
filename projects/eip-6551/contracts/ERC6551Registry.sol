// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.4;

import "./interfaces/IERC6551Registry.sol";

/**
 * @title ERC6551Registry - EIP-6551 레지스트리 구현
 * @notice
 *  - 토큰 바운드 계정(Token Bound Account, TBA)의 주소 예측(account)과 생성(createAccount)을 담당합니다.
 *  - CREATE2를 사용하여 결정적 주소를 생성합니다.
 * @dev
 *  - 본 프로젝트는 EIP-6551 TBA 개념 학습용 예제입니다. 실제 프로덕션에서는 감사된 구현 사용을 권장합니다.
 *  - 어셈블리로 EIP-1167 미니멀 프록시 코드를 구성하고, 프록시 런타임 뒤에 96바이트 footer
 *    (chainId 32, tokenContract 20→32 정렬, tokenId 32)를 덧붙인 바이트열을 기준으로 주소를 계산/배포합니다.
 */
contract ERC6551Registry is IERC6551Registry {
    /**
     * @notice 주어진 매개변수로 TBA를 생성하고 주소를 반환합니다.
     * @dev
     *  - 동일 파라미터로 이미 배포되어 있으면 해당 주소를 그대로 반환합니다.
     *  - 내부적으로 EIP-1167 프록시 생성 코드와 footer 데이터를 조합해 init-code 해시를 만든 뒤 CREATE2로 배포합니다.
     * @param implementation 구현(로직) 컨트랙트 주소
     * @param salt CREATE2 솔트
     * @param chainId 귀속 대상 체인 ID(경고 억제를 위해 pop 처리)
     * @param tokenContract 귀속 대상 ERC721 컨트랙트 주소
     * @param tokenId 귀속 대상 토큰 ID
     * @return 생성되었거나 이미 존재하던 TBA 주소
     */
    function createAccount(
        address implementation,
        bytes32 salt,
        uint256 chainId,
        address tokenContract,
        uint256 tokenId
    ) external returns (address) {
        assembly {
            // Silence unused variable warnings
            pop(chainId)

            // ------------------------------------------------------------------
            // 1) init-code 구성에 필요한 상수/파라미터를 메모리에 적재
            // ------------------------------------------------------------------
            calldatacopy(0x8c, 0x24, 0x80)           // [0x8c..] salt, chainId, tokenContract, tokenId (총 0x80)
            mstore(0x6c, 0x5af43d82803e903d91602b57fd5bf3) // [0x6c..] EIP-1167 footer (runtime용)
            mstore(0x5d, implementation)                 // [0x5d..] 구현 컨트랙트 주소
            mstore(0x49, 0x3d60ad80600a3d3981f3363d3d373d3d3d363d73) // [0x49..] EIP-1167 constructor+header

            // ------------------------------------------------------------------
            // 2) CREATE2 주소 계산에 필요한 프리이미지 구성
            //   keccak256(0xff ++ address(this) ++ salt ++ keccak256(init-code))
            // ------------------------------------------------------------------
            mstore(0x35, keccak256(0x55, 0xb7))       // [0x35..] keccak256(init-code)
            mstore(0x15, salt)                        // [0x15..] salt
            mstore(0x01, shl(96, address()))          // [0x01..] this (registry) address
            mstore8(0x00, 0xff)                        // [0x00]   0xff prefix

            // Compute account address
            let computed := keccak256(0x00, 0x55)

            // If the account has not yet been deployed
            if iszero(extcodesize(computed)) {
                // Deploy account contract
                let deployed := create2(0, 0x55, 0xb7, salt) // init-code at [0x55..0x55+0xb7)

                // Revert if the deployment fails
                if iszero(deployed) {
                    mstore(0x00, 0x20188a59) // AccountCreationFailed()
                    revert(0x1c, 0x04)
                }

                // Store account address in memory before salt and chainId
                mstore(0x6c, deployed)

                // Emit the ERC6551AccountCreated event
                log4(
                    0x6c,
                    0x60,
                    0x79f19b3655ee38b1ce526556b7731a20c8f218fbda4a3990b6cc4172fdf88722, // event selector
                    implementation,
                    tokenContract,
                    tokenId
                )

                // Return the account address
                return(0x6c, 0x20)
            }

            // Otherwise, return the computed account address
            mstore(0x00, shr(96, shl(96, computed)))
            return(0x00, 0x20)
        }
    }

    /**
     * @notice 동일 파라미터로 배포될 TBA 주소를 계산합니다(배포하지 않음).
     * @dev createAccount와 동일한 init-code 레이아웃을 사용해 keccak 기반으로 계산합니다.
     * @param implementation 구현(로직) 컨트랙트 주소
     * @param salt CREATE2 솔트
     * @param chainId 귀속 대상 체인 ID(경고 억제를 위해 pop 처리)
     * @param tokenContract 귀속 대상 ERC721 컨트랙트 주소
     * @param tokenId 귀속 대상 토큰 ID
     * @return 계산된 TBA 주소
     */
    function account(
        address implementation,
        bytes32 salt,
        uint256 chainId,
        address tokenContract,
        uint256 tokenId
    ) external view returns (address) {
        assembly {
            // Silence unused variable warnings
            pop(chainId)
            pop(tokenContract)
            pop(tokenId)

            // ------------------------------------------------------------------
            // 1) init-code 구성과 동일한 레이아웃으로 메모리 채우기
            // ------------------------------------------------------------------
            calldatacopy(0x8c, 0x24, 0x80)           // [0x8c..] salt, chainId, tokenContract, tokenId
            mstore(0x6c, 0x5af43d82803e903d91602b57fd5bf3) // [0x6c..] EIP-1167 footer
            mstore(0x5d, implementation)                 // [0x5d..] 구현 컨트랙트 주소
            mstore(0x49, 0x3d60ad80600a3d3981f3363d3d373d3d3d363d73) // [0x49..] constructor+header

            // ------------------------------------------------------------------
            // 2) CREATE2 주소 계산 프리이미지 구성
            // ------------------------------------------------------------------
            mstore(0x35, keccak256(0x55, 0xb7))       // keccak256(init-code)
            mstore(0x15, salt)                        // salt
            mstore(0x01, shl(96, address()))          // address(this)
            mstore8(0x00, 0xff)                        // 0xff

            // Store computed account address in memory and return
            mstore(0x00, shr(96, shl(96, keccak256(0x00, 0x55))))
            return(0x00, 0x20)
        }
    }
}


