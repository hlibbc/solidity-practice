// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../../contracts/MyNFT.sol";
import "../../contracts/ERC6551Account.sol";
import "../../contracts/ERC6551Registry.sol";

contract DemoScript is Script {
    function run() external {
        // anvil 첫 번째 계정으로 브로드캐스트
        vm.startBroadcast();

        // 1) NFT 배포 및 민트(브로드캐스터에게)
        MyNFT nft = new MyNFT();
        uint256 tokenId = nft.mint(msg.sender);

        // 2) 6551 구현 + 레지스트리 배포
        ERC6551Account impl = new ERC6551Account();
        ERC6551Registry reg = new ERC6551Registry();

        // 3) 주소 예측 → 실제 생성
        bytes32 salt = keccak256("DEMO_SALT_V1");
        address predicted = reg.account(address(impl), salt, block.chainid, address(nft), tokenId);
        address tba = reg.createAccount(address(impl), salt, block.chainid, address(nft), tokenId);

        console2.log("Predicted TBA:", predicted);
        console2.log("Created   TBA:", tba);

        // 4) token() 확인
        (uint256 c, address tokenContract, uint256 tid) = ERC6551Account(payable(tba)).token();
        console2.log("token(): chainId=%s token=%s tokenId=%s", c, tokenContract, tid);

        // 5) TBA에 자금 송금 + execute() 호출(현재 NFT 소유자=브로드캐스터)
        (bool ok,) = tba.call{value: 0.05 ether}("");
        require(ok, "fund failed");

        // 간단한 타깃: MyNFT.supportsInterface(ERC721 ID 0x80ac58cd)
        bytes memory data = abi.encodeWithSignature("supportsInterface(bytes4)", 0x80ac58cd);
        ERC6551Account(payable(tba)).execute(address(nft), 0, data, 0);

        vm.stopBroadcast();
    }
}
