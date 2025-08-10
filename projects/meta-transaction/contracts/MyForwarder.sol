// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";

/**
 * @title MyDefaultForwarder (revert reason bubbling)
 * @notice
 *  - OZ ERC2771Forwarder(v5.3)의 execute를 오버라이드
 *  - 대상 컨트랙트에서 발생한 revert 데이터를 그대로 버블링(revert)
 *  - 가스 포워딩 안전성 체크(EIP-150 관련) 로직을 원본과 동치로 inline
 *
 * @dev
 *  - _validate, _useNonce를 그대로 사용
 *  - 호출 데이터는 ERC-2771 규격대로 suffix(원 서명자 주소)를 붙여 호출:
 *      bytes memory data = abi.encodePacked(request.data, request.from);
 *  - msg.value와 request.value는 일치해야 합니다.
 */
contract MyDefaultForwarder is ERC2771Forwarder {
    constructor() ERC2771Forwarder("MyDefaultForwarder") {}

    /// 편의용(디버깅)
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /**
     * @notice 대상 컨트랙트를 직접 call하여 실패 시 원문 revert 데이터를 그대로 재-리버트합니다.
     */
    function execute(ForwardRequestData calldata request)
        public
        payable
        override
    {
        // 원본과 동일한 값 일치 검증
        if (msg.value != request.value) {
            revert ERC2771ForwarderMismatchedValue(request.value, msg.value);
        }

        // === 원본의 검증 플로우 재현 ===
        (bool isTrustedByTarget, bool active, bool signerMatch, address signer) = _validate(request);
        if (!isTrustedByTarget) {
            revert ERC2771UntrustfulTarget(request.to, address(this));
        }
        if (!active) {
            revert ERC2771ForwarderExpiredRequest(request.deadline);
        }
        if (!signerMatch) {
            revert ERC2771ForwarderInvalidSigner(signer, request.from);
        }

        // nonce 사용(원본 Nonces 흐름 준수)
        uint256 currentNonce = _useNonce(signer);

        // === 대상 호출 준비 ===
        uint256 reqGas = request.gas;
        address to = request.to;
        uint256 value = request.value;
        // ERC-2771 규격: data || from
        bytes memory data = abi.encodePacked(request.data, request.from);

        // === low-level call로 직접 실행해 returndata 확보 ===
        bool success;
        bytes memory ret;
        uint256 gasLeftAfter;

        assembly {
            // call(gas, to, value, in, insize, out, outsize)
            success := call(reqGas, to, value, add(data, 0x20), mload(data), 0, 0)
            let size := returndatasize()
            ret := mload(0x40)
            mstore(0x40, add(ret, add(size, 0x20)))
            mstore(ret, size)
            returndatacopy(add(ret, 0x20), 0, size)
            gasLeftAfter := gas()
        }

        // === EIP-150 기반 가스 전달 보증 체크(원본 _checkForwardedGas 동치) ===
        // 남은 가스가 req.gas/63 보다 작다면 invalid()로 모든 가스 소모
        if (gasLeftAfter < request.gas / 63) {
            assembly {
                invalid()
            }
        }

        // 원본 이벤트와 동일하게 기록
        emit ExecutedForwardRequest(signer, currentNonce, success);

        // 실패 시 대상의 revert 데이터를 "그대로" 버블링
        if (!success) {
            assembly {
                revert(add(ret, 0x20), mload(ret))
            }
        }
        // 성공 시에는 아무 것도 하지 않음(원본과 동일)
    }
}

/**
 * @title MyWhitelistForwarder
 * @author hlibbc
 * @notice Add a whitelist to MyDefaultForwarder
 * @dev You can prevent indiscriminate malicious attacks 
 * by ensuring that only requests from whitelisted contracts are accepted.
 * Whitelist management is performed by the owner.
 *
 * 화이트리스트에 등록된 계약의 요청만 수락하도록 하여 무차별적인 악의적 공격을 방지할 수 있습니다.
 * 화이트리스트 관리는 소유자가 수행합니다.
 */
contract MyWhitelistForwarder is MyDefaultForwarder {

}

/**
 * @title MyPluggableForwarder
 * @author hlibbc
 * @notice Add a pluggable policy mechanism to MyDefaultForwarder
 * @dev This forwarder delegates authorization logic to an external contract
 * that implements a pluggable policy interface.
 * Only requests approved by the connected policy contract are forwarded.
 * The policy contract can be upgraded to reflect dynamic business rules.
 *
 * 이 forwarder는 인증 로직을 외부 정책 계약에 위임합니다.
 * 연결된 정책 계약이 승인한 요청만 forwarding되며,
 * 정책 계약은 업그레이드가 가능하여 유동적인 비즈니스 조건에 유연하게 대응할 수 있습니다.
 */
contract MyPluggableForwarder is MyDefaultForwarder {

}