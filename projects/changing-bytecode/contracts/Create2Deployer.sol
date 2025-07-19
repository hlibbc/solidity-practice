// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./Attack.sol";

contract Create2Deployer {
    event Deployed(address addr, bytes32 salt);
    event Deployed2(address addr, bytes32 salt);

    /// @notice 새 Attack을 CREATE2로 띄울 때, 생성자에 _treasury 주소를 넘겨줘야 한다
    function deployCreate2(bytes32 _salt, address _treasury)
        public
        payable
        returns (address)
    {
        // salt: _salt, constructor argument: _treasury
        address addr = address(
            new Attack{ salt: _salt }(_treasury)
        );
        emit Deployed2(addr, _salt);
        return addr;
    }

    /// @notice raw bytecode 뒤에 생성자 인코딩을 붙여서 CREATE2
    function deployCreate2Assembly(bytes32 _salt, address _treasury)
        public
        payable
        returns (address addr)
    {
        // 1) 원본 creationCode
        bytes memory bytecode = type(Attack).creationCode;
        // 2) 생성자 인자(address) ABI‐인코딩을 뒤에 붙인다
        bytes memory initCode = abi.encodePacked(
            bytecode,
            abi.encode(_treasury)
        );

        assembly {
            // 3) callvalue() 만큼 ETH를 전송(optional)
            //    initCode 메모리 위치: add(initCode, 0x20), 길이: mload(initCode)
            addr := create2(callvalue(), add(initCode, 0x20), mload(initCode), _salt)
            if iszero(extcodesize(addr)) {
                revert(0, 0)
            }
        }
        emit Deployed(addr, _salt);
    }

    /// @notice (옵션) 바이트코드+인자까지 미리 보고 싶으면 이렇게
    function getInitCode(address _treasury) public pure returns (bytes memory) {
        return abi.encodePacked(
            type(Attack).creationCode,
            abi.encode(_treasury)
        );
    }
}
