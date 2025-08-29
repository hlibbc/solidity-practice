// scripts/previewReferrerEarnedYesterday.js
/**
 * @fileoverview
 *  특정 사용자의 어제 획득한 레퍼럴 보상 토큰 수량을 미리보기하는 스크립트
 *  TokenVesting 컨트랙트의 previewReferrerEarnedYesterday 함수를 호출하여
 *  어제(전날) 사용자가 레퍼럴 보상으로 획득한 토큰 수량을 조회합니다.
 * 
 * 실행:
 *   npx hardhat run scripts/previewReferrerEarnedYesterday.js -- <wallet_address>
 *   예시: npx hardhat run scripts/previewReferrerEarnedYesterday.js -- 0x1234...
 * 
 * 환경변수(../.env):
 *   OWNER_KEY=<개인키>
 *   PROVIDER_URL=<RPC URL> (선택, 기본값: http://127.0.0.1:8545)
 * 
 * 주의사항:
 *   - 사용자는 레퍼럴 코드를 가지고 있어야 합니다.
 *   - 레퍼럴 보상은 다른 사용자의 구매에 대한 수수료입니다.
 *   - 어제 날짜는 컨트랙트의 내부 로직에 따라 결정됩니다.
 *   - 컨트랙트에 previewReferrerEarnedYesterday 함수가 구현되어 있어야 합니다.
 * 
 * @author hlibbc
 */

require("dotenv").config();
const { pickAddressArg, attachVestingWithEthers, ethers } = require("./_shared");

// =============================================================================
// 메인 함수
// =============================================================================

/**
 * @notice 메인 함수 - 사용자의 어제 획득한 레퍼럴 보상 토큰 수량을 조회하고 출력
 */
async function main() {
    // === 명령행 인수에서 사용자 주소 추출 ===
    const user = pickAddressArg();
    if (!user) {
        throw new Error("❌ 사용자 지갑 주소를 명령행 인수로 제공해야 합니다.");
    }

    // === 컨트랙트 연결 및 배포 정보 로드 ===
    const { d, vesting } = await attachVestingWithEthers();
    console.log("🔗 TokenVesting 컨트랙트에 연결 완료");

    // === 어제 획득한 레퍼럴 보상 토큰 수량 조회 ===
    console.log("🔍 사용자의 어제 획득한 레퍼럴 보상 토큰 수량을 조회 중...");
    
    // 주의: 컨트랙트에 이름을 previewReferrerEarnedYesterday 로 배포하셨다는 가정
    const y18 = await vesting.previewReferrerEarnedYesterday(user);
    console.log("✅ 어제 획득한 레퍼럴 보상 토큰 수량 조회 완료");

    // === 결과 출력 ===
    console.log("\n=== Referrer Earned (어제) ===");
    console.log("🌐 네트워크    :", d.network?.name || process.env.HARDHAT_NETWORK || "unknown");
    console.log("🔗 Vesting    :", d.vesting);               // ⬅ 여기!
    console.log("👤 사용자     :", user);
    
    // 18자리 소수점 단위의 원본 값과 ETH 단위로 변환된 값 출력
    const ethAmount = ethers.formatUnits(y18, 18);
    console.log("💰 amount18   :", y18.toString(), `(≈ ${ethAmount} ETH)`);
    
    console.log("\n🎉 어제 레퍼럴 보상 획득량 미리보기 완료!");
}

// =============================================================================
// 스크립트 실행 및 에러 처리
// =============================================================================

main().catch((e) => { 
    console.error("❌ 스크립트 오류:", e); 
    process.exit(1); 
});
