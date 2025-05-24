// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/interfaces/IERC1271.sol";


contract NestedPermit is EIP712 {
    string private constant SIGNING_DOMAIN = "NestedPermitApp";
    string private constant SIGNATURE_VERSION = "1";

    constructor() EIP712(SIGNING_DOMAIN, SIGNATURE_VERSION) {}

    struct Person {
        address wallet;
        string name;
    }

    struct Order {
        Person from;
        Person to;
        uint256 amount;
        uint256 nonce;
    }

    bytes32 private constant PERSON_TYPEHASH =
        keccak256("Person(address wallet,string name)");

    bytes32 private constant ORDER_TYPEHASH =
        keccak256(
            "Order(Person from,Person to,uint256 amount,uint256 nonce)Person(address wallet,string name)"
        );

    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function hashPerson(Person memory person) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                PERSON_TYPEHASH,
                person.wallet,
                keccak256(bytes(person.name))
            )
        );
    }

    function hashOrder(Order memory order) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                ORDER_TYPEHASH,
                hashPerson(order.from),
                hashPerson(order.to),
                order.amount,
                order.nonce
            )
        );
    }

    function verify(Order memory order, bytes memory signature) public view returns (bool) {
        bytes32 digest = _hashTypedDataV4(hashOrder(order));
        address signer = order.from.wallet;

        if (signer.code.length > 0) {
            // 컨트랙트 기반 서명자 (EIP-1271)
            try IERC1271(signer).isValidSignature(digest, signature) returns (bytes4 magicValue) {
                return magicValue == IERC1271.isValidSignature.selector;
            } catch {
                return false;
            }
        } else {
            // 일반 EOA 계정
            return ECDSA.recover(digest, signature) == signer;
        }
    }

    function recoverSigner(
        Order memory order,
        bytes memory signature
    ) public view returns (address) {
        bytes32 digest = _hashTypedDataV4(hashOrder(order));
        address signer = order.from.wallet;

        if (signer.code.length > 0) {
            try IERC1271(signer).isValidSignature(digest, signature) returns (bytes4 magicValue) {
                if (magicValue == IERC1271.isValidSignature.selector) {
                    return signer; // ✅ isValidSignature 통과한 컨트랙트 signer 반환
                } else {
                    return address(0); // ❌ invalid signature
                }
            } catch {
                return address(0); // ❌ 호출 실패 시도 fallback
            }
        } else {
            // EOA는 일반적으로 ECDSA recover
            return ECDSA.recover(digest, signature);
        }
    }
}
