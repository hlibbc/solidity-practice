/**
 * @file getDomainSeperator.js
 * @notice MyPermitToken 컨트랙트의 domainSeparator 값을 읽어오는 스크립트
 * @author hlibbc
 */
const hre = require("hardhat");
const { ethers } = hre;

/**
 * @notice 현재 연결된 체인의 지정된 컨트랙트의 domainSeparator 값을 읽어온다.
 * @dev ethers v6 버전 사용
 *      - EIP-2612 permit 기능에서 사용되는 domainSeparator 계산
 *      - 컨트랙트 주소를 명령행 인수로 받음
 */
async function main() {
    // ===== 테스트용 변수 설정 =====
    // 이 값들을 쉽게 변경하여 테스트할 수 있습니다
    // const testName = "MyPermitToken";           // 컨트랙트 이름
    // const testVersion = "1";                    // 버전
    // const testChainId = 31337n;                 // 체인 ID (hardhat 기본값)
    // const testVerifyingContract = "0xa85233C63b9Ee964Add6F2cffe00Fd84eb32338f"; // 컨트랙트 주소
    
    //// Arbitrum USDT
    // const testName = "USD₮0";           // 컨트랙트 이름
    // const testVersion = "1";                    // 버전
    // const testChainId = 42161n;                 // 체인 ID (hardhat 기본값)
    // const testVerifyingContract = "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9"; // 컨트랙트 주소

    // //// Base USDT
    const testName = "USD Coin";           // 컨트랙트 이름
    const testVersion = "2";                    // 버전
    const testChainId = 8453n;                 // 체인 ID (hardhat 기본값)
    const testVerifyingContract = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // 컨트랙트 주소

    // 명령행 인수에서 컨트랙트 주소 가져오기 (없으면 테스트 값 사용)
    const contractAddress = process.argv[2] || testVerifyingContract;
    
    console.log("🧪 테스트 모드:", !process.argv[2] ? "활성" : "비활성");
    console.log("📝 사용할 값들:");
    console.log("   - name:", testName);
    console.log("   - version:", testVersion);
    console.log("   - chainId:", testChainId);
    console.log("   - verifyingContract:", contractAddress);

    try {
        // 컨트랙트 주소 유효성 검사
        if (!ethers.isAddress(contractAddress)) {
            throw new Error("유효하지 않은 컨트랙트 주소입니다.");
        }

        console.log("\n🔍 컨트랙트 주소:", contractAddress);
        
        // 현재 네트워크 정보 가져오기
        const network = await hre.ethers.provider.getNetwork();
        console.log("🌐 네트워크:", network.name);
        console.log("🔗 체인 ID:", network.chainId);

        // MyPermitToken 컨트랙트 인스턴스 생성
        // const MyPermitToken = await ethers.getContractFactory("MyPermitToken");
        // const permitToken = MyPermitToken.attach(contractAddress);

        // console.log("📋 컨트랙트 이름:", await permitToken.name());
        // console.log("🏷️  컨트랙트 심볼:", await permitToken.symbol());

        // DOMAIN_SEPARATOR() 함수 호출
        // console.log("\n🔐 Domain Separator 읽는 중...");
        // const domainSeparator = await permitToken.DOMAIN_SEPARATOR();
        
        // console.log("✅ Domain Separator:");
        // console.log("   값:", domainSeparator);
        // console.log("   길이:", domainSeparator.length, "문자");

        // Domain Separator 구조 분석
        console.log("\n📊 Domain Separator 분석:");
        
        // EIP-712 domain separator 구조 (테스트 변수 사용)
        const domain = {
            name: testName,
            version: testVersion,
            chainId: testChainId,
            verifyingContract: contractAddress
        };
        
        console.log("   Domain 구조:");
        console.log("   - name:", domain.name);
        console.log("   - version:", domain.version);
        console.log("   - chainId:", domain.chainId);
        console.log("   - verifyingContract:", domain.verifyingContract);

        // 올바른 방법: ethers.TypedDataEncoder 사용
        const calculatedDomainSeparator = ethers.TypedDataEncoder.hashDomain(domain);
        console.log("\n🔍 계산 결과:");
        console.log("   계산된 값:", calculatedDomainSeparator);
        console.log("   길이:", calculatedDomainSeparator.length, "문자");

        // 추가: 실제 컨트랙트 값과 테스트 값 비교
        // console.log("\n🔄 실제 vs 테스트 값 비교:");
        // const actualDomain = {
        //     name: await permitToken.name(),
        //     version: "1",
        //     chainId: Number(network.chainId),
        //     verifyingContract: contractAddress
        // };
        
        // const actualCalculatedDomainSeparator = ethers.TypedDataEncoder.hashDomain(actualDomain);
        
        // console.log("   실제 컨트랙트 값:", actualCalculatedDomainSeparator);
        // console.log("   테스트 값:", calculatedDomainSeparator);
        // console.log("   비교 결과:", actualCalculatedDomainSeparator === calculatedDomainSeparator ? "✅ 일치" : "❌ 불일치");

    } catch (error) {
        console.error("❌ 오류 발생:", error.message);
        
        if (error.message.includes("유효하지 않은 컨트랙트 주소")) {
            console.log("💡 올바른 컨트랙트 주소를 입력해주세요.");
        } else if (error.message.includes("call revert")) {
            console.log("💡 해당 주소에 MyPermitToken 컨트랙트가 배포되어 있지 않습니다.");
        } else {
            console.log("💡 네트워크 연결을 확인하거나 컨트랙트가 올바르게 배포되었는지 확인해주세요.");
        }
        
        process.exit(1);
    }
}

// 스크립트 실행
main().catch((error) => {
    console.error("❌ 스크립트 실행 중 오류 발생:", error);
    process.exit(1);
});
