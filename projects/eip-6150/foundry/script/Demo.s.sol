// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {MyERC6150} from "../../contracts/MyERC6150.sol";

contract DeployAndDemo is Script {
    function run() external {
        // 브로드캐스트 시작
        uint256 pk = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(pk);

        // 1) 배포
        MyERC6150 rev = new MyERC6150("Rev6150", "REV");
        console2.log("Deployed MyERC6150 at:", address(rev));

        // 2) 배포자에게 루트 민트 권한 부여
        address deployer = vm.addr(pk);
        rev.setRootMinter(deployer, true);

        // 3) 루트/자식 민트
        uint256 root1 = rev.mintRoot(deployer);
        console2.log("mintRoot ->", root1); // 1

        uint256 child1 = rev.mintChild(deployer, root1);
        console2.log("mintChild(root1) ->", child1); // 2

        // 4) 자식 소각(성공)
        rev.safeBurn(child1);
        console2.log("safeBurn(child1) OK");

        // 5) 다시 자식 민트 후 부모 변경 데모
        uint256 child2 = rev.mintChild(deployer, root1); // 2
        uint256 root2 = rev.mintRoot(deployer);          // 3
        console2.log("mintChild(root1)->", child2, ", mintRoot()->", root2);

        // 부모를 root2로 변경
        rev.transferParent(root2, child2);
        console2.log("transferParent(child2 -> root2) OK");

        vm.stopBroadcast();
    }
}
