// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/interfaces/IERC1271.sol";
import "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import "./interfaces/IERC6551Account.sol";
import "./interfaces/IERC6551Executable.sol";

/**
 * @title ERC6551Account - EIP-6551 토큰 바운드 계정 구현
 * @notice
 *  - 특정 ERC721 토큰의 소유자를 계정의 owner로 간주하는 간단한 참조 구현
 *  - execute(콜 위임), EIP-1271 서명 검증, ERC-165 인터페이스 지원
 * @dev
 *  - 본 프로젝트는 EIP-6551 개념 학습용 예제 코드입니다.
 */
contract ERC6551Account is IERC165, IERC1271, IERC6551Account, IERC6551Executable {
    uint256 immutable deploymentChainId = block.chainid;

    uint256 public state;

    /**
     * @notice ETH 수신 전용 함수
     */
    receive() external payable {}

    /**
     * @notice 외부 호출을 수행합니다. (operation=0: call 만 지원)
     * @dev 호출자(msg.sender)는 유효 서명자여야 합니다.
     * @param to 호출 대상 주소
     * @param value 전송 ETH(wei)
     * @param data 호출 데이터
     * @param operation 0이면 call, 그 외는 revert
     * @return result 원시 반환 데이터
     */
    function execute(
        address to, 
        uint256 value, 
        bytes calldata data, 
        uint8 operation
    ) external payable virtual
        returns (bytes memory result)
    {
        require(_isValidSigner(msg.sender), "Invalid signer");
        require(operation == 0, "Only call operations are supported");

        ++state;

        bool success;
        (success, result) = to.call{value: value}(data);
        if (!success) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
    }

    /**
     * @notice 서명자 유효성을 조회합니다.
     * @param signer 확인할 서명자
     * @param 구현 특화 컨텍스트(미사용 시 빈 바이트)
     * @return magicValue 유효 시 IERC6551Account.isValidSigner.selector, 아니면 0x00000000
     */
    function isValidSigner(
        address signer, 
        bytes calldata /*context*/
    ) external view virtual 
        returns (bytes4) 
    {
        if (_isValidSigner(signer)) {
            return IERC6551Account.isValidSigner.selector;
        }
        return bytes4(0);
    }

    /**
     * @notice EIP-1271: 컨트랙트 기반 서명 검증
     * @param hash 메시지 해시
     * @param signature 서명 데이터
     * @return magicValue 유효 시 IERC1271.isValidSignature.selector, 아니면 0x00000000
     */
    function isValidSignature(bytes32 hash, bytes memory signature)
        external view virtual
        returns (bytes4 magicValue)
    {
        bool isValid = SignatureChecker.isValidSignatureNow(owner(), hash, signature);
        if (isValid) {
            return IERC1271.isValidSignature.selector;
        }
        return bytes4(0);
    }

    /**
     * @notice ERC-165 인터페이스 지원 여부
     */
    function supportsInterface(bytes4 interfaceId) 
        external pure virtual 
        returns (bool) 
    {
        return interfaceId == type(IERC165).interfaceId
            || interfaceId == type(IERC6551Account).interfaceId
            || interfaceId == type(IERC6551Executable).interfaceId;
    }

    /**
     * @notice 이 계정이 귀속된 NFT 식별자 정보를 반환합니다.
     * @return chainId 체인 ID
     * @return tokenContract ERC721 컨트랙트 주소
     * @return tokenId 토큰 ID
     */
    function token() 
        public view virtual 
        returns (uint256, address, uint256) 
    {
        bytes memory footer = new bytes(0x60);
        assembly {
            extcodecopy(address(), add(footer, 0x20), 0x4d, 0x60)
        }
        return abi.decode(footer, (uint256, address, uint256));
    }

    /**
     * @notice 현재 계정의 owner(귀속된 NFT의 현재 소유자)를 반환합니다.
     * @dev 배포 체인과 귀속 체인이 다르면 주소(0)를 반환합니다.
     * @return 소유자 주소
     */
    function owner() public view virtual returns (address) {
        (uint256 chainId, address tokenContract, uint256 tokenId) = token();
        if (chainId != deploymentChainId) return address(0);
        return IERC721(tokenContract).ownerOf(tokenId);
    }

    /**
     * @notice 내부 유틸: 서명자 유효성 판단(= owner 여부)
     * @param signer 검사 대상 주소
     * @return 서명 가능 여부
     */
    function _isValidSigner(address signer) internal view virtual returns (bool) {
        return signer == owner();
    }
}
