// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interface/IRandomnessReceiver.sol";
import "./interface/IVRFProxy.sol";

contract VRFNft is IRandomnessReceiver {
    IVRFProxy public immutable VRF;

    event MintQueued(uint256 indexed requestId, address indexed to, uint256 tokenId);
    event MintFinalized(uint256 indexed requestId, address indexed to, uint256 tokenId, uint256 rand);

    struct PendingMint {
        address to;
        uint256 tokenId;
    }

    mapping(uint256 => PendingMint) public pendingMint;

    uint256 private _nextId = 1;

    constructor(address vrfProxy) {
        VRF = IVRFProxy(vrfProxy);
    }

    function mint() external payable returns (uint256 requestId) {
        uint256 tokenId = _nextId++;
        // ctx로 tokenId를 포장
        bytes32 ctx = bytes32(tokenId);

        // 필요한 KAIA를 함께 전송
        requestId = VRF.requestRandom{value: msg.value}(ctx, msg.sender);

        pendingMint[requestId] = PendingMint({to: msg.sender, tokenId: tokenId});
        emit MintQueued(requestId, msg.sender, tokenId);
    }

    // VRFProxy가 콜백해줌
    function onRandomnessReady(uint256 requestId, uint256 randomWord, bytes32 ctx) external override {
        require(msg.sender == address(VRF), "only VRF");
        PendingMint memory p = pendingMint[requestId];
        delete pendingMint[requestId];

        uint256 tokenId = uint256(ctx); // 위에서 bytes32(tokenId)로 넣었음

        // 예시: 1~50
        uint256 rand = (randomWord % 50) + 1;

        // 실제 민팅/메타데이터 결정 등 수행
        // _mint(p.to, tokenId);
        // _applyRandomTraits(tokenId, rand);

        emit MintFinalized(requestId, p.to, tokenId, rand);
    }
}
