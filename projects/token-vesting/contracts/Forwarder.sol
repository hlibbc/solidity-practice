// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
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
contract WhitelistForwarder is Ownable, ERC2771Forwarder {

    // def. variable
    mapping(address => bool) public whitelist; // 화이트리스트 매핑변수
    mapping(address => mapping(bytes4 => bool)) public isAllowed; // 대납허용 리스트
    
    // def. error
    /**
     * @notice 에러: whitelist에 등록되지 않음
     * @param target whitelist 등록여부를 확인할 주소
     */
    error NotWhitelisted(address target);
    
    /**
     * @notice 에러: msg.sender가 Owner가 아님
     */
    error NotOwner();

    /**
     * @notice 에러: 잘못된 주소 (null)
     */
    error InvalidAddress();

    /**
     * @notice 에러: 허용되지 않은 selector
     * @param target 호출자 주소
     * @param selector 위임대납 요청한 selector
     */
    error SelectorNotAllowed(
        address target, 
        bytes4 selector
    );

    // def. event
    /**
     * @notice 이벤트: 화이트리스트에 추가됨
     * @param target 추가된 주소
     */
    event WhitelistAdded(address indexed target);

    /**
     * @notice 이벤트: 화이트리스트에서 삭제됨
     * @param target 삭제된 주소
     */
    event WhitelistRemoved(address indexed target);

    /**
     * @notice 이벤트: 위임대납 허용리스트 업데이트
     * @param target 대납 호출자 (msg.sender)
     * @param selector 대납허용리스트에 갱신될 function selector
     * @param flag 허용여부 (true: 허용, false: 거부)
     */
    event AllowedFunctionSet(
        address indexed target, 
        bytes4 selector, 
        bool flag
    );

    // def. function
    constructor() Ownable(msg.sender) ERC2771Forwarder("WhitelistForwarder") {}
    
    /**
     * @notice domainSeparator 값을 반환한다.
     * @dev 편의용(디버깅)
     */
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
    
    /**
     * @notice 주소를 화이트리스트에 추가한다.
     * @param target 추가할 주소
     * @dev onlyOwner
     */
    function addToWhitelist(address target) external onlyOwner {
        if (target == address(0)) {
            revert InvalidAddress();
        }
        whitelist[target] = true;
        emit WhitelistAdded(target);
    }
    
    /**
     * @notice 주소를 화이트리스트에서 제거한다.
     * @param target 제거할 주소
     * @dev onlyOwner
     */
    function removeFromWhitelist(address target) external onlyOwner {
        if (target == address(0)) {
            revert InvalidAddress();
        }
        whitelist[target] = false;
        emit WhitelistRemoved(target);
    }
    
   /**
     * @notice 여러 주소를 화이트리스트에 추가한다.
     * @param targets 추가할 주소들
     * @dev onlyOwner
     */
    function addBatchToWhitelist(address[] calldata targets) external onlyOwner {
        for (uint256 i = 0; i < targets.length; i++) {
            if (targets[i] == address(0)) {
                revert InvalidAddress();
            }
            whitelist[targets[i]] = true;
            emit WhitelistAdded(targets[i]);
        }
    }
    
    /**
     * @notice 여러 주소를 화이트리스트에서 제거한다.
     * @param targets 제거할 주소들
     * @dev onlyOwner
     */
    function removeBatchFromWhitelist(address[] calldata targets) external onlyOwner {
        for (uint256 i = 0; i < targets.length; i++) {
            if (targets[i] == address(0)) {
                revert InvalidAddress();
            }
            whitelist[targets[i]] = false;
            emit WhitelistRemoved(targets[i]);
        }
    }

    /**
     * @notice 위임허용 function list를 갱신한다.
     * @param target 위임대납을 호출하는 컨트랙트 주소 (execute의 msg.sender)
     * @param selector target이 소유한, 위임대납 처리할 function selector
     * @param allowed 위임대납 여부 (true: 대납 O, false: 대납: X)
     * @dev onlyOwner
     */
    function setAllowed(
        address target, 
        bytes4 selector, 
        bool allowed
    ) external onlyOwner {
        isAllowed[target][selector] = allowed;
        emit AllowedFunctionSet(target, selector, allowed);
    }

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
    
    /**
     * @notice 화이트리스트 검증을 추가한 execute 함수
     * @param request ForwardRequestData 구조체
     */
    function execute(
        ForwardRequestData calldata request
    ) public payable override {
        if (!whitelist[request.to]) { // check: whitelist 
            revert NotWhitelisted(request.to);
        }
        if (msg.value != request.value) { // check: msg.value
            revert ERC2771ForwarderMismatchedValue(request.value, msg.value);
        }
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
        bytes4 extractedSelector = _selectorOf(request.data);
        if(!isAllowed[request.to][extractedSelector]) {
            revert SelectorNotAllowed(request.to, extractedSelector);
        }
        uint256 currentNonce = _useNonce(signer);
        uint256 reqGas = request.gas;
        address to = request.to;
        uint256 value = request.value;
        bytes memory data = abi.encodePacked(request.data, request.from); // feat. EIP-2771
        // For parse returndata
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
        emit ExecutedForwardRequest(signer, currentNonce, success); // 원본 이벤트와 동일하게 기록
        if (!success) { // 실패 시 대상의 revert 데이터를 "그대로" 버블링
            assembly {
                revert(add(ret, 0x20), mload(ret))
            }
        }
        // 성공 시에는 아무 것도 하지 않음(원본과 동일)
    }

    /**
     * @notice data에서 selector를 추출하여 반환한다.
     * @param data ix data
     * @return sel 추출된 selector
     */
    function _selectorOf(bytes calldata data) internal pure returns (bytes4 sel) {
        if (data.length >= 4) {
            // 첫 4바이트가 함수 셀렉터
            assembly { sel := calldataload(data.offset) }
        } else {
            sel = bytes4(0); // receive/fallback 등
        }
    }
}