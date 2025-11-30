// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {MyERC6150} from "../../contracts/MyERC6150.sol";

/**
 * @title DeployAndDemo - ERC-6150 데모 배포/시연 스크립트
 * @notice
 *  - Foundry Script를 이용해 `MyERC6150`을 배포하고, 루트/자식 민트, 소각, 부모 변경 동작을 순차적으로 시연합니다.
 * @dev
 *  - 브로드캐스트 키는 환경변수 `PRIVATE_KEY`에서 읽습니다.
 *  - `forge script` 실행 시 `--broadcast` 옵션을 주면 실제 트랜잭션이 브로드캐스트됩니다.
 *  - 출력 로그는 `console2.log`를 통해 확인할 수 있습니다.
 * @custom:usage
 *  1) .env에 PRIVATE_KEY 설정
 *  2) 로컬 노드 실행 후: `forge script foundry/script/Demo.s.sol:DeployAndDemo --rpc-url http://127.0.0.1:8545 --broadcast`
 *  3) 또는 드라이런: `forge script foundry/script/Demo.s.sol:DeployAndDemo --rpc-url http://127.0.0.1:8545`
 */
contract DeployAndDemo is Script {
    /**
     * @notice 스크립트 진입점. 배포 → 권한 설정 → 민트/소각/부모변경 데모를 수행합니다.
     * @dev
     *  - 환경변수 `PRIVATE_KEY`를 읽어 브로드캐스트를 시작/종료합니다.
     *  - 각 단계별로 상태를 로그로 출력합니다.
     */
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
