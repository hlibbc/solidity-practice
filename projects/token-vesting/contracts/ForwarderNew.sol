// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";

/**
 * @title WhitelistForwarder
 * @notice Target(컨트랙트) 화이트리스트 + 함수 셀렉터 허용 정책을 Forwarder 내부에 주입
 * @dev 정책은 _execute()에서만 강제하여, OZ의 execute/executeBatch 시맨틱을 보존한다.
 *      - 단건 execute(): invalid 시 명확히 revert, 대상 컨트랙트 revert 데이터 버블링
 *      - 배치 executeBatch(): invalid/실패 항목은 false로 처리되어 스킵/환불 시맨틱 유지
 */
contract WhitelistForwarder is Ownable, ERC2771Forwarder {
    // target -> allowed
    mapping(address => bool) public whitelist;
    // target -> selector -> allowed
    mapping(address => mapping(bytes4 => bool)) public isAllowed;

    // errors
    error InvalidAddress();
    error NotWhitelisted(address target);
    error SelectorNotAllowed(address target, bytes4 selector);

    // events
    event WhitelistAdded(address indexed target);
    event WhitelistRemoved(address indexed target);
    event AllowedFunctionSet(address indexed target, bytes4 selector, bool flag);

    constructor() Ownable(msg.sender) ERC2771Forwarder("WhitelistForwarder") {}

    /// @dev 디버깅 편의용
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // --- whitelist mgmt ---
    function addToWhitelist(address target) external onlyOwner {
        if (target == address(0)) revert InvalidAddress();
        whitelist[target] = true;
        emit WhitelistAdded(target);
    }

    function removeFromWhitelist(address target) external onlyOwner {
        if (target == address(0)) revert InvalidAddress();
        whitelist[target] = false;
        emit WhitelistRemoved(target);
    }

    function addBatchToWhitelist(address[] calldata targets) external onlyOwner {
        for (uint256 i = 0; i < targets.length; i++) {
            if (targets[i] == address(0)) revert InvalidAddress();
            whitelist[targets[i]] = true;
            emit WhitelistAdded(targets[i]);
        }
    }

    function removeBatchFromWhitelist(address[] calldata targets) external onlyOwner {
        for (uint256 i = 0; i < targets.length; i++) {
            if (targets[i] == address(0)) revert InvalidAddress();
            whitelist[targets[i]] = false;
            emit WhitelistRemoved(targets[i]);
        }
    }

    // --- selector policy mgmt ---
    function setAllowed(address target, bytes4 selector, bool allowed) external onlyOwner {
        isAllowed[target][selector] = allowed;
        emit AllowedFunctionSet(target, selector, allowed);
    }

    /// @notice execute/executeBatch 양쪽에서 공통으로 호출되는 내부 실행 경로
    /// @dev 여기서 정책(whitelist + selector)과 유효성(Trusted, Active, SignerMatch)을 검사하고,
    ///      requireValidRequest 여부에 따라 revert/false 처리 시맨틱을 맞춘다.
    function _execute(
        ForwardRequestData calldata request,
        bool requireValidRequest
    ) internal override returns (bool success) {
        // 0) 정책 검사: target whitelist + selector allowlist
        bytes4 sel = _selectorOf(request.data);
        bool policyOk = whitelist[request.to] && isAllowed[request.to][sel];

        if (!policyOk) {
            if (requireValidRequest) {
                // 단건 execute(): 명확히 revert
                if (!whitelist[request.to]) revert NotWhitelisted(request.to);
                revert SelectorNotAllowed(request.to, sel);
            } else {
                // 배치 executeBatch(): invalid로 간주 → false 반환하여 스킵/환불 시맨틱 유지
                return false;
            }
        }

        // 1) 기본 유효성 검사 (Trusted target / deadline / signer)
        (bool isTrustedByTarget, bool active, bool signerMatch, address signer) = _validate(request);
        if (!(isTrustedByTarget && active && signerMatch)) {
            if (requireValidRequest) {
                if (!isTrustedByTarget) revert ERC2771UntrustfulTarget(request.to, address(this));
                if (!active) revert ERC2771ForwarderExpiredRequest(request.deadline);
                revert ERC2771ForwarderInvalidSigner(signer, request.from);
            } else {
                return false;
            }
        }

        // 2) nonce 소모
        uint256 currentNonce = _useNonce(signer);

        // 3) 대상 호출 (EIP-2771: from을 data 뒤에 붙임)
        uint256 reqGas = request.gas;
        address to = request.to;
        uint256 value = request.value;
        bytes memory data = abi.encodePacked(request.data, request.from);

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

        // 4) EIP-150 가스 보장: reqGas/63 보다 남은 가스가 적으면 invalid()로 소모
        if (gasLeftAfter < reqGas / 63) {
            assembly {
                invalid()
            }
        }

        // 5) 이벤트 (OZ와 동일한 시그니처)
        emit ExecutedForwardRequest(signer, currentNonce, success);

        // 6) 실패 처리
        if (!success) {
            if (requireValidRequest) {
                // 단건 execute(): 대상 컨트랙트 revert 데이터를 "그대로" 버블링
                assembly {
                    revert(add(ret, 0x20), mload(ret))
                }
            } else {
                // 배치 executeBatch(): false 반환 → 상위에서 환불 시맨틱 처리
                return false;
            }
        }

        return true;
    }

    /// @dev data 첫 4바이트를 함수 셀렉터로 안전 추출 (상위 4바이트 정렬)
    function _selectorOf(bytes calldata data) internal pure returns (bytes4 sel) {
        if (data.length >= 4) {
            assembly {
                sel := shr(224, calldataload(data.offset))
            }
        } else {
            sel = bytes4(0); // fallback/receive
        }
    }
}
