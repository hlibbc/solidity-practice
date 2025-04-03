// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IERC1271 {
    function isValidSignature(bytes32 _hash, bytes memory _signature) external view returns (bytes4 magicValue);
    // function isValidSignature(bytes32 _hash, bytes memory _signature) external returns (bytes4 magicValue);
}

contract MySmartWallet is IERC1271 {
    address public owner;

    // EIP-1271 매직값: 성공 시 반드시 이 값을 반환해야 함 -> bytes4(keccak256("isValidSignature(bytes32,bytes)")
    bytes4 internal constant MAGICVALUE = 0x1626ba7e;

    // event DebugHash(bytes32 hash);
    // event DebugRecovered(address signer);

    constructor(address _owner) {
        owner = _owner;
    }

    // 이 함수가 핵심! 서명 유효성 검증
    function isValidSignature(bytes32 _hash, bytes memory _signature) external view override returns (bytes4) {
        // emit DebugHash(_hash);
        // 서명으로부터 signer 복원
        address signer = recoverSigner(_hash, _signature);
        // emit DebugRecovered(signer);

        // 서명자가 owner와 일치하면 MAGICVALUE 반환 (성공)
        if (signer == owner) {
            return MAGICVALUE;
        } else {
            return 0xffffffff; // 실패 시 아무 값이나 반환 (보통 이렇게 처리)
        }
    }

    // ecrecover로 signer address 복원
    function recoverSigner(bytes32 _hash, bytes memory _signature) internal pure returns (address) {
        require(_signature.length == 65, "Invalid signature length");

        bytes32 r;
        bytes32 s;
        uint8 v;

        assembly {
            r := mload(add(_signature, 32))
            s := mload(add(_signature, 64))
            v := byte(0, mload(add(_signature, 96)))
        }

        if (v < 27) {
            v += 27;
        }

        require(v == 27 || v == 28, "Invalid v value");

        return ecrecover(_hash, v, r, s);
    }
}
