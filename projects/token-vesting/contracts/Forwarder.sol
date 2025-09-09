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
     * @notice 에러: 잘못된 주소 (null)
     */
    error InvalidAddress();

    /**
     * @notice 에러: 허용되지 않은 selector
     * @param target 대상 컨트랙트(request.to)
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

    /**
     * @notice 화이트리스트 검증을 추가한 execute 함수
     * @param request ForwardRequestData 구조체
     */
    function execute(
        ForwardRequestData calldata request
    ) public payable override {
        // 0) value 일치
        if (msg.value != request.value) {
            revert ERC2771ForwarderMismatchedValue(request.value, msg.value);
        }
        // 1) 정책 검사: target whitelist + selector allowlist
        bytes4 sel = _selectorOf(request.data);
        if(!whitelist[request.to]) {
            revert NotWhitelisted(request.to);
        }
        if(!isAllowed[request.to][sel]) {
            revert SelectorNotAllowed(request.to, sel);
        }
        // 2) 유효성 검사 (Trusted / deadline / signer)
        (bool isTrusted, bool active, bool signerMatch, address signer) = _validate(request);
        if(!isTrusted) {
            revert ERC2771UntrustfulTarget(request.to, address(this));
        }
        if(!active) {
            revert ERC2771ForwarderExpiredRequest(request.deadline);
        }
        if(!signerMatch) {
            revert ERC2771ForwarderInvalidSigner(signer, request.from);
        }
        // 3) nonce 소모
        uint256 currentNonce = _useNonce(signer);
        // 4) 대상 호출 (EIP-2771)
        uint256 reqGas = request.gas;
        address to = request.to;
        uint256 value = request.value;
        bytes memory data = abi.encodePacked(request.data, request.from);

        bool success;
        uint256 gasLeftAfter;
        bytes memory ret;
        assembly {
            success := call(reqGas, to, value, add(data, 0x20), mload(data), 0, 0)
            let size := returndatasize()
            ret := mload(0x40)
            mstore(0x40, add(ret, add(size, 0x20)))
            mstore(ret, size)
            returndatacopy(add(ret, 0x20), 0, size)
            gasLeftAfter := gas()
        }
        // 5) EIP-150 가스 보장: 요청가스/63 보다 남으면 전체 롤백(데이터 없음)
        if (gasLeftAfter < reqGas / 63) {
            assembly { invalid() }
        }
        // 6) 이벤트 (OZ와 동일)
        emit ExecutedForwardRequest(signer, currentNonce, success);
        // 7) 실패면 타깃의 revert 데이터를 그대로 버블링
        if (!success) {
            assembly { revert(add(ret, 0x20), mload(ret)) }
        }
    }

    /**
     * @notice data에서 selector를 추출하여 반환한다.
     * @param data ix data
     * @return sel 추출된 selector
     */
    function _selectorOf(bytes calldata data) internal pure returns (bytes4 sel) {
        // if (data.length >= 4) {
        //     assembly {
        //         sel := shr(224, calldataload(add(data.offset, 32)))
        //     }
        // } else {
        //     sel = bytes4(0); // fallback/receive (기본 비허용)
        // }
        if (data.length < 4) return 0x00000000;
        // 가장 안전한 방법: 앞 4바이트 슬라이스
        return bytes4(data[0:4]);
    }

    /**
     * @dev req.data(=calldata)에 대해 forwarder가 인식하는 selector를 그대로 반환
     */
    function debugSelector(bytes calldata data) external pure returns (bytes4) {
        return _selectorOf(data);
    }

    /**
     * @dev (to, data) 기준으로 selector와 isAllowed 값을 함께 반환
     */
    function debugAllowed(address to, bytes calldata data)
        external
        view
        returns (bytes4 sel, bool allowed)
    {
        sel = _selectorOf(data);
        allowed = isAllowed[to][sel]; // 여러분 컨트랙트의 맵 이름에 맞춰 수정
    }
}