// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../../contracts/MyNFT.sol";
import "../../contracts/ERC6551Account.sol";
import "../../contracts/ERC6551Registry.sol";

/**
 * @title DemoScript - EIP-6551 TBA 데모 배포/실행 스크립트
 * @notice
 *  - 예제 NFT를 배포·민트하고, 6551 Account 구현/레지스트리를 배포합니다.
 *  - Registry의 account()로 주소를 예측한 뒤 createAccount()로 실제 생성합니다.
 *  - 생성된 TBA에 자금을 송금하고, execute()로 간단한 호출을 수행합니다.
 * @dev
 *  - 본 프로젝트는 EIP-6551 TBA 개념 학습용 예제입니다 [[memory:7556543]].
 *  - 실행 전 OS 환경변수 `PRIVATE_KEY`를 설정해야 합니다.
 *  - 일반 실행 예: `forge script foundry/script/Demo.s.sol:DemoScript -f http://127.0.0.1:8545 --broadcast`
 *  - anvil 등 로컬 체인에서 실행하며, vm.startBroadcast(pk)로 브로드캐스터를 지정합니다.
 */
contract DemoScript is Script {
    /**
     * @notice 데모 시나리오 실행 엔트리포인트
     * @dev 순서
     *  1) MyNFT 배포 및 브로드캐스터에게 1개 민트
     *  2) ERC6551Account 구현, ERC6551Registry 배포
     *  3) Registry.account()로 예측 주소 계산 → createAccount()로 실제 배포
     *  4) 생성된 TBA에 ETH 송금 후, execute()로 대상 컨트랙트 호출
     *  - 요구사항: OS 환경변수 `PRIVATE_KEY` 설정(브로드캐스트 계정 비밀키)
     */
    function run() external {
        // anvil 첫 번째 계정으로 브로드캐스트
        uint256 pk = vm.envUint("PRIVATE_KEY"); // OS 환경변수에서 PRIVATE_KEY 읽어 uint256으로 파싱
        address eoa = vm.addr(pk); // 브로드캐스트 계정 주소 (pk에 대응하는 주소 추출)
        /**
         * vm.startBroadcast:
         * 이 시점부터 발생하는 “상태 변경” 호출을 트랜잭션으로 전송하도록 전환
         * msg.sender = vm.addr(pk)가 됨 
         */
        vm.startBroadcast(pk);

        // 1) NFT 배포 및 민트(브로드캐스터에게)
        MyNFT nft = new MyNFT(); // msg.sender: eoa
        console2.log("NFT address:", address(nft));
        uint256 tokenId = nft.mint(eoa);

        console2.log("NFT Owner after mint:", nft.ownerOf(tokenId));

        // 2) 6551 구현 + 레지스트리 배포
        ERC6551Account impl = new ERC6551Account(); // TBA 구현 컨트랙트(implementation) 배포
        ERC6551Registry reg = new ERC6551Registry(); // TBA Registry 배포 (EIP-1167: clone)

        // 3) 주소 예측 → 실제 생성
        bytes32 salt = keccak256("DEMO_SALT_V1"); // salt: TBA 주소를 고정시키기 위한 식별자
        address predicted = reg.account(address(impl), salt, block.chainid, address(nft), tokenId); // 생성될 TBA 주소
        address tba = reg.createAccount(address(impl), salt, block.chainid, address(nft), tokenId); // 생성된 TBA 주소

        console2.log("Predicted TBA:", predicted);
        console2.log("Created   TBA:", tba);

        // 4) token() 확인
        (uint256 c, address tokenContract, uint256 tid) = ERC6551Account(payable(tba)).token();
        console2.log("token(): chainId=%s token=%s tokenId=%s", c, tokenContract, tid);

        // 5) TBA에 자금 송금 + execute() 호출(현재 NFT 소유자=브로드캐스터)
        (bool ok,) = tba.call{value: 0.05 ether}("");
        require(ok, "fund failed");

        // 7) TBA를 통해 MyNFT.supportsInterface(IERC721) 호출하고 결과 읽기
        bytes4 iid = type(IERC721).interfaceId; // 0x80ac58cd
        bytes memory callData =
            abi.encodeWithSelector(IERC165.supportsInterface.selector, iid);

        bytes memory ret = _execAndReturn(tba, address(nft), callData);
        bool isSupported = abi.decode(ret, (bool));
        console2.log("supportsInterface(IERC721)?", isSupported);


        vm.stopBroadcast();
    }

    /**
     * @notice TBA의 execute()를 통해 타깃 컨트랙트로 콜을 위임 실행하고, 원본 반환값을 추출합니다.
     * @dev ERC6551Account.execute는 bytes를 감싼 bytes 형태로 반환하므로 한 번 디코드해 원본을 돌려줍니다.
     * @param tba 실행을 수행할 TBA 주소
     * @param target 호출 대상 컨트랙트 주소
     * @param data ABI 인코딩된 호출 데이터
     * @return ret 타깃 컨트랙트가 반환한 원본 바이트 결과
     */
    function _execAndReturn(address tba, address target, bytes memory data)
        internal
        returns (bytes memory ret)
    {
        (bool ok, bytes memory out) = payable(tba).call(
            abi.encodeWithSelector(
                ERC6551Account.execute.selector,
                target,
                0,
                data,
                0
            )
        );
        require(ok, "TBA execute call failed");

        // out = abi.encode( bytes(innerRet) ) 형태이므로 한 번 벗겨서 반환
        bytes memory inner = abi.decode(out, (bytes));
        return inner;
    }
}
