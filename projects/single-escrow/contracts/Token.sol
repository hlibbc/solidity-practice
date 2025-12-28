// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title PermitToken
 * @notice EIP-2612(Permit) 지원 ERC20 테스트 토큰 + 서명 디버깅 헬퍼
 * @dev
 *  `Main.createEscrow()`는 `IERC20Permit(token).permit(...)` 호출을 전제로 합니다.
 *  로컬 테스트/학습을 쉽게 하기 위해:
 *   - OZ `ERC20Permit` 기반의 간단한 토큰을 제공하고
 *   - permit 서명 검증에 유용한 해시(structHash/digest) 및 서명자 복구(recover) 함수를 제공합니다.
 *
 * 주의:
 *  - 이 토큰은 constructor에서 배포자에게 대량 민트합니다(학습/테스트 목적).
 *  - `PERMIT_TYPEHASH`는 EIP-2612 표준 문자열과 동일해야 하며, 디버깅 출력과의 비교를 위해 상수로 둡니다.
 */
contract PermitToken is ERC20Permit {

    constructor()
        ERC20("PermitToken", "PPT")
        ERC20Permit("PermitToken")
    {
        _mint(msg.sender, 1000000 * 10 ** decimals());
    }

    // =============================================================================
    // EIP-2612 Permit 디버깅
    // =============================================================================
    bytes32 private constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    /**
     * @notice permit 서명 검증에 필요한 해시들을 그대로 노출합니다.
     * @dev
     *  - structHash: EIP-712 구조체 해시(permit message)
     *  - digest: EIP-712 도메인까지 포함된 최종 서명 대상 해시
     *
     * 참고:
     *  - offchain에서 만든 digest와 onchain digest가 다르면,
     *    보통 chainId / verifyingContract / name / version / nonce / deadline 불일치입니다.
     */
    function debugPermit_getAllHashes(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline
    ) public view returns (bytes32 structHash, bytes32 digest) {
        structHash = keccak256(abi.encode(PERMIT_TYPEHASH, owner, spender, value, nonces(owner), deadline));
        digest = _hashTypedDataV4(structHash);
    }

    /**
     * @notice (디버깅) permit 서명(v,r,s)로부터 복구되는 서명자 주소를 반환합니다.
     * @dev
     *  - 반환값이 owner와 동일해야 정상 서명입니다.
     *  - ECDSA.recover는 malleability 관련 검증을 포함합니다(OZ 구현 기준).
     */
    function debugPermit_getSigner(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) public view returns (address) {
        bytes32 structHash = keccak256(abi.encode(PERMIT_TYPEHASH, owner, spender, value, nonces(owner), deadline));

        bytes32 hash = _hashTypedDataV4(structHash);

        return ECDSA.recover(hash, v, r, s);
    }
}
