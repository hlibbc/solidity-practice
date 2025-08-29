// scripts/previewReferrerClaimable.js
/**
 * @fileoverview
 *  특정 사용자의 현재 레퍼럴 보상 청구 가능한 토큰 수량을 미리보기하는 스크립트
 *  TokenVesting 컨트랙트의 previewReferrerClaimable 함수를 호출하여
 *  현재 시점에서 사용자가 레퍼럴 보상으로 청구할 수 있는 토큰 수량을 조회합니다.
 * 
 * 실행:
 *   npx hardhat run scripts/previewReferrerClaimable.js -- <wallet_address>
 *   예시: npx hardhat run scripts/previewReferrerClaimable.js -- 0x1234...
 * 
 * 환경변수(../.env):
 *   OWNER_KEY=<개인키>
 *   PROVIDER_URL=<RPC URL> (선택, 기본값: http://127.0.0.1:8545)
 * 
 * 주의사항:
 *   - 사용자는 레퍼럴 코드를 가지고 있어야 합니다.
 *   - 레퍼럴 보상은 다른 사용자의 구매에 대한 수수료입니다.
 *   - 컨트랙트에 previewReferrerClaimable 함수가 구현되어 있어야 합니다.
 * 
 * @author hlibbc
 */

require("dotenv").config();
const { pickAddressArg, attachVestingWithEthers, ethers } = require("./_shared");

// =============================================================================
// 유틸리티 함수들
// =============================================================================

/**
 * @notice BigInt 값을 6자리 소수점 단위로 내림 처리하는 함수
 * @param {bigint} x - 처리할 BigInt 값
 * @returns {bigint} 6자리 소수점 단위로 내림 처리된 값
 * 
 * 예시: 1234567890123456789n -> 1234567890120000000n
 *       (18자리 소수점에서 12자리 소수점 단위로 내림)
 * 
 * 용도: 레퍼럴 보상의 정확한 계산을 위해 소수점 단위를 일정하게 맞춤
 */
function floor6(x) { 
    const mod = 10n ** 12n; 
    return x - (x % mod); 
}

// =============================================================================
// 메인 함수
// =============================================================================

/**
 * @notice 메인 함수 - 사용자의 현재 레퍼럴 보상 청구 가능한 토큰 수량을 조회하고 출력
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

    // === 현재 시점에서 레퍼럴 보상 청구 가능한 토큰 수량 조회 ===
    console.log("🔍 사용자의 레퍼럴 보상 청구 가능한 토큰 수량을 조회 중...");
    const ref18 = await vesting.previewReferrerClaimable(user);
    console.log("✅ 레퍼럴 보상 청구 가능한 토큰 수량 조회 완료");

    // === 결과 출력 ===
    console.log("\n=== Referrer Claimable (현재 시점) ===");
    console.log("🌐 네트워크    :", d.network?.name || process.env.HARDHAT_NETWORK || "unknown");
    console.log("🔗 Vesting    :", d.vesting);             // ⬅ 여기!
    console.log("👤 사용자     :", user);
    console.log("💰 amount18   :", ref18.toString());
    
    // 6자리 소수점 단위로 내림 처리된 값과 ETH 단위로 변환된 값 출력
    const flooredAmount = floor6(ref18);
    const ethAmount = ethers.formatUnits(flooredAmount, 18);
    console.log("📊 floor6→18  :", flooredAmount.toString(), `(≈ ${ethAmount} ETH)`);
    
    console.log("\n🎉 레퍼럴 보상 미리보기 완료!");
}

// =============================================================================
// 스크립트 실행 및 에러 처리
// =============================================================================

main().catch((e) => { 
    console.error("❌ 스크립트 오류:", e); 
    process.exit(1); 
});
