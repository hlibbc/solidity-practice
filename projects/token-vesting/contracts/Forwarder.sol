// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";

/**
 * @title WhitelistForwarder
 * @author hlibbc
 * @notice Add a whitelist to MyDefaultForwarder
 * @dev You can prevent indiscriminate malicious attacks 
 * by ensuring that only requests from whitelisted contracts are accepted.
 * Whitelist management is performed by the owner.
 *
 * 화이트리스트에 등록된 계약의 요청만 수락하도록 하여 무차별적인 악의적 공격을 방지할 수 있습니다.
 * 화이트리스트 관리는 소유자가 수행합니다.
 */
contract WhitelistForwarder is ERC2771Forwarder {
    // === 상태 변수 ===
    mapping(address => bool) public whitelist;
    address public owner;
    
    // === 이벤트 ===
    event WhitelistAdded(address indexed target, address indexed addedBy);
    event WhitelistRemoved(address indexed target, address indexed removedBy);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    
    // === 에러 ===
    error NotWhitelisted(address target);
    error NotOwner();
    error InvalidAddress();

    // === 수정자 ===
    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }
    
    // === 생성자 ===
    constructor() ERC2771Forwarder("WhitelistForwarder") {
        owner = msg.sender;
    }
    
    /// 편의용(디버깅)
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
    
    // === whitelist 관리 함수 ===
    
    /**
     * @notice 주소를 whitelist에 추가
     * @param target 추가할 주소
     */
    function addToWhitelist(address target) external onlyOwner {
        if (target == address(0)) revert InvalidAddress();
        whitelist[target] = true;
        emit WhitelistAdded(target, msg.sender);
    }
    
    /**
     * @notice 주소를 whitelist에서 제거
     * @param target 제거할 주소
     */
    function removeFromWhitelist(address target) external onlyOwner {
        if (target == address(0)) revert InvalidAddress();
        whitelist[target] = false;
        emit WhitelistRemoved(target, msg.sender);
    }
    
    /**
     * @notice 여러 주소를 한 번에 whitelist에 추가
     * @param targets 추가할 주소 배열
     */
    function addBatchToWhitelist(address[] calldata targets) external onlyOwner {
        for (uint256 i = 0; i < targets.length; i++) {
            if (targets[i] == address(0)) revert InvalidAddress();
            whitelist[targets[i]] = true;
            emit WhitelistAdded(targets[i], msg.sender);
        }
    }
    
    /**
     * @notice 여러 주소를 한 번에 whitelist에서 제거
     * @param targets 제거할 주소 배열
     */
    function removeBatchFromWhitelist(address[] calldata targets) external onlyOwner {
        for (uint256 i = 0; i < targets.length; i++) {
            if (targets[i] == address(0)) revert InvalidAddress();
            whitelist[targets[i]] = false;
            emit WhitelistRemoved(targets[i], msg.sender);
        }
    }
    
    /**
     * @notice 주소가 whitelist에 등록되어 있는지 확인
     * @param target 확인할 주소
     * @return 등록 여부
     */
    function isWhitelisted(address target) external view returns (bool) {
        return whitelist[target];
    }
    
    // === 소유권 관리 ===
    
    /**
     * @notice 새로운 소유자에게 권한 이전
     * @param newOwner 새로운 소유자 주소
     */
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        address oldOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }
    
    /**
     * @notice 소유권 포기 (주의: 되돌릴 수 없음)
     */
    function renounceOwnership() external onlyOwner {
        address oldOwner = owner;
        owner = address(0);
        emit OwnershipTransferred(oldOwner, address(0));
    }
    
    // === execute 함수 오버라이드 ===
    
    /**
     * @notice whitelist 검증을 추가한 execute 함수
     * @param request ForwardRequestData 구조체
     */
    function execute(ForwardRequestData calldata request)
        public
        payable
        override
    {
        // === whitelist 검증 추가 ===
        if (!whitelist[request.to]) {
            revert NotWhitelisted(request.to);
        }
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