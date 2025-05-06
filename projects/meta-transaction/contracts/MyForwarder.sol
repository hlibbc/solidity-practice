// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";

/**
 * @title MyDefaultForwarder
 * @author hlibbc
 * @notice Default forwarder inherited from Openzeppelin's ERC2771Forwarder
 * @dev If the ForwardRequestData template and signature match,
 * it performs unconditional forwarding.
 * It does not consider any other conditions,
 * so it cannot be used as a real service.
 *
 * ForwardRequestData 템플릿과 서명이 일치하면 조건 없이 전달합니다.
 * 다른 조건을 고려하지 않기 때문에 실제 서비스에는 사용할 수 없습니다.
 */
contract MyDefaultForwarder is ERC2771Forwarder {
    constructor() ERC2771Forwarder("MyDefaultForwarder") {}

    // MyDefaultForwarder.sol
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
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