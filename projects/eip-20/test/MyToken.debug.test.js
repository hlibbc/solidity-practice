/**
 * @file MyToken.debug.test.js
 * @notice MyToken ERC20 컨트랙트 테스트 스크립트
 * @author hlibbc
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * @notice MyToken ERC20 컨트랙트의 기능을 테스트한다.
 * @dev ethers v6 버전 사용, chai assertion 라이브러리 사용
 */
describe("MyToken", function () {
    let myToken;
    let deployer;

    /**
     * @notice 각 테스트 전에 실행되는 설정 함수
     * @dev 새로운 MyToken 인스턴스를 배포하고 deployer 계정을 설정한다.
     */
    beforeEach(async function () {
        // 첫 번째 signer (default deployer) 사용
        [deployer] = await ethers.getSigners();

        const MyToken = await ethers.getContractFactory("MyToken");
        myToken = await MyToken.deploy();
        await myToken.waitForDeployment();
    });

    /**
     * @notice 토큰의 name이 올바르게 설정되었는지 테스트한다.
     * @dev ERC20 표준의 name() 함수 호출 결과를 검증한다.
     */
    it("should return the correct name", async function () {
        expect(await myToken.name()).to.equal("MyToken");
    });

    /**
     * @notice 토큰의 symbol이 올바르게 설정되었는지 테스트한다.
     * @dev ERC20 표준의 symbol() 함수 호출 결과를 검증한다.
     */
    it("should return the correct symbol", async function () {
        expect(await myToken.symbol()).to.equal("MTK");
    });

    /**
     * @notice 초기 공급량이 deployer에게 올바르게 민팅되었는지 테스트한다.
     * @dev balanceOf() 함수를 사용하여 deployer의 잔액이 10000 * 10^18 wei인지 확인한다.
     */
    it("should mint initial supply to deployer", async function () {
        const balance = await myToken.balanceOf(deployer.address);
        expect(balance).to.equal(ethers.parseUnits("10000", 18)); // 10000 * 10^18
    });
});
