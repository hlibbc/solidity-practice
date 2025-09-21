// =============================================================================
// Commitment Verifier 배포 스크립트
// =============================================================================
// 이 스크립트는 snarkjs로 생성한 Solidity 검증자(contracts/CommitmentVerifier.sol)
// 를 하드햇 네트워크(또는 지정된 네트워크)에 배포합니다.
//
// 사전 조건:
// 1) ./scripts/build.sh commitment 실행으로 검증자 컨트랙트가 생성되어 있어야 합니다.
//    - contracts/CommitmentVerifier.sol
// 2) 하드햇 설정에서 현재 네트워크의 체인/계정이 준비되어 있어야 합니다.
//
// 실행:
//   npx hardhat run scripts/deploy.js --network <network>
// =============================================================================

const { ethers } = require("hardhat");

async function main() {
    // 컨트랙트 팩토리 가져오기
    const Verifier = await ethers.getContractFactory("CommitmentVerifier");

    // 배포 트랜잭션 생성/송신
    const verifier = await Verifier.deploy();

    // 배포 완료 대기 (주소 할당 보장)
    await verifier.waitForDeployment();

    // 배포 주소 출력
    console.log("CommitmentVerifier:", await verifier.getAddress());
}

// 에러 핸들링
main().catch((e) => { console.error(e); process.exit(1); });
