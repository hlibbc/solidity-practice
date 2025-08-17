require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const hre = require('hardhat');
const { ethers } = hre;

const DAY = 86400n;
const ZERO = ethers.ZeroAddress;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitIfNeeded() {
  if (hre.network.name === 'localhost' || hre.network.name === 'hardhat' || hre.network.name === 'development') {
    console.log('⏳ 다음 tx를 위해 1초 대기...');
    await sleep(1000);
  }
}

function toJsonableBigInts(arr) {
  return arr.map((x) => x.toString());
}
function isUtcMidnight(tsBig) { return (tsBig % DAY) === 0n; }

async function main() {
  console.log('🚀 TokenVesting / BadgeSBT / StableCoin 배포 스크립트 시작');

  // ── 필수: 배포자
  const ownerKey = process.env.OWNER_KEY;
  if (!ownerKey) throw new Error('❌ .env에 OWNER_KEY를 설정하세요.');
  const providerUrl = process.env.PROVIDER_URL || 'http://localhost:8545';
  const provider = new ethers.JsonRpcProvider(providerUrl);
  const owner = new ethers.Wallet(ownerKey, provider);

  console.log('🌐 네트워크:', hre.network.name);
  console.log('👤 Deployer:', owner.address);

  // ─────────────────────────────────────────────────────────────
  // 🔒 하드코딩된 베스팅 시작/종료값
  const START_TS = 1748908800n;
  const ENDS = [1780444799n, 1811980799n, 1843603199n, 1875139199n]; // inclusive
  // 필요시 값 조정
  const BUYER_TOTALS = [
    ethers.parseUnits('170000000', 18),
    ethers.parseUnits('87500000', 18),
    ethers.parseUnits('52500000', 18),
    ethers.parseUnits('40000000', 18),
  ];
  const REF_TOTALS = [
    ethers.parseUnits('15000000', 18),
    ethers.parseUnits('15000000', 18),
    0n,
    0n,
  ];
  // ─────────────────────────────────────────────────────────────

  // 기타 파라미터
  const FORWARDER = process.env.FORWARDER_ADDRESS || ZERO;
  const STABLECOIN_ADDRESS = process.env.STABLECOIN_ADDRESS || ''; // 있으면 재사용
  const VESTING_TOKEN_ADDRESS = process.env.VESTING_TOKEN_ADDRESS || ''; // 선택
  const SBT_NAME = process.env.SBT_NAME || 'Badge';
  const SBT_SYMBOL = process.env.SBT_SYMBOL || 'BDG';

  if (!isUtcMidnight(START_TS)) {
    console.warn('⚠️ START_TS가 UTC 자정으로 정렬되지 않았습니다. (권장: 자정)');
  }
  if (!(ENDS.length > 0 && ENDS.length === BUYER_TOTALS.length && ENDS.length === REF_TOTALS.length)) {
    throw new Error('❌ ends/buyerTotals/refTotals 길이가 일치해야 합니다.');
  }
  for (let i = 0; i < ENDS.length; i++) {
    if (ENDS[i] <= START_TS) throw new Error(`❌ ENDS[${i}]는 START_TS 이후여야 합니다.`);
    if (i > 0 && ENDS[i] <= ENDS[i - 1]) throw new Error('❌ ENDS 배열은 엄격히 증가해야 합니다.');
  }

  console.log('\n📋 배포 파라미터 (하드코딩)');
  console.log('  - START_TS :', START_TS.toString());
  console.log('  - ENDS     :', ENDS.map(String));
  console.log('  - BUYER_TOTALS(18dec):', BUYER_TOTALS.map(String));
  console.log('  - REF_TOTALS  (18dec):', REF_TOTALS.map(String));
  console.log('  - FORWARDER:', FORWARDER);

  try {
    // 1) StableCoin(USDT) 배포 or 재사용
    let stableAddr = STABLECOIN_ADDRESS;
    if (!stableAddr) {
      console.log('\n1️⃣ StableCoin(USDT) 배포 중...(contracts/Usdt.sol: StableCoin)');
      const Stable = await ethers.getContractFactory('StableCoin', owner);
      const stable = await Stable.deploy();
      await stable.waitForDeployment();
      stableAddr = await stable.getAddress();
      console.log('✅ StableCoin 배포 완료:', stableAddr);
      await waitIfNeeded();
    } else {
      console.log('\n1️⃣ StableCoin 배포 스킵. 기존 주소 사용:', stableAddr);
    }

    // 2) BadgeSBT 배포
    console.log('\n2️⃣ BadgeSBT 배포 중...');
    const BadgeSBT = await ethers.getContractFactory('BadgeSBT', owner);
    const sbt = await BadgeSBT.deploy(SBT_NAME, SBT_SYMBOL, owner.address);
    await sbt.waitForDeployment();
    const sbtAddr = await sbt.getAddress();
    console.log('✅ BadgeSBT 배포 완료:', sbtAddr);
    await waitIfNeeded();

    // 3) TokenVesting 배포
    console.log('\n3️⃣ TokenVesting 배포 중...');
    const TV = await ethers.getContractFactory('TokenVesting', owner);
    const vesting = await TV.deploy(FORWARDER, stableAddr, START_TS);
    await vesting.waitForDeployment();
    const vestingAddr = await vesting.getAddress();
    console.log('✅ TokenVesting 배포 완료:', vestingAddr);
    await waitIfNeeded();

    // 4) 스케줄 초기화
    console.log('\n4️⃣ 스케줄 초기화...');
    const txInit = await vesting.initializeSchedule(ENDS, BUYER_TOTALS, REF_TOTALS);
    await txInit.wait();
    console.log('✅ initializeSchedule 완료');
    await waitIfNeeded();

    // 5) SBT admin 이관 → Vesting, 그리고 Vesting.setBadgeSBT
    console.log('\n5️⃣ SBT admin 이관 → Vesting, 그리고 Vesting.setBadgeSBT...');
    const txAdmin = await sbt.setAdmin(vestingAddr);
    await txAdmin.wait();
    console.log('   • sbt.setAdmin(Vesting) 완료');
    await waitIfNeeded();

    const txSetSbt = await vesting.setBadgeSBT(sbtAddr);
    await txSetSbt.wait();
    console.log('   • vesting.setBadgeSBT(SBT) 완료');
    await waitIfNeeded();

    // 6) (선택) vestingToken 설정
    if (VESTING_TOKEN_ADDRESS && VESTING_TOKEN_ADDRESS !== ZERO) {
      console.log('\n6️⃣ vestingToken 설정 중...');
      const txSetToken = await vesting.setVestingToken(VESTING_TOKEN_ADDRESS);
      await txSetToken.wait();
      console.log('✅ vestingToken 설정 완료:', VESTING_TOKEN_ADDRESS);
      await waitIfNeeded();
    } else {
      console.log('\n6️⃣ vestingToken 설정은 스킵(미지정). 추후 setVestingToken으로 설정 가능.');
    }

    // 7) 결과 저장
    const deploymentInfo = {
      network: (await provider.getNetwork()).toJSON?.() ?? await provider.getNetwork(),
      deployer: owner.address,
      forwarder: FORWARDER,
      startTs: START_TS.toString(),
      contracts: {
        stableCoin: stableAddr,
        badgeSBT: sbtAddr,
        tokenVesting: vestingAddr,
        vestingToken: VESTING_TOKEN_ADDRESS || null,
      },
      schedule: {
        ends: toJsonableBigInts(ENDS),
        buyerTotals: toJsonableBigInts(BUYER_TOTALS),
        refTotals: toJsonableBigInts(REF_TOTALS),
      },
      time: new Date().toISOString(),
      blockNumber: await provider.getBlockNumber(),
    };

    const outDir = path.join(__dirname, 'output');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, `deployment-info.json`);
    fs.writeFileSync(outFile, JSON.stringify(deploymentInfo, null, 2));
    console.log(`\n💾 배포 정보를 ${outFile} 에 저장했습니다.`);
    console.log('\n🎉 모든 배포 단계 완료!');
  } catch (err) {
    console.error('❌ 배포 중 오류:', err);
    process.exit(1);
  }
}

main()
  .then(() => { console.log('\n🎯 배포 스크립트 정상 종료'); process.exit(0); })
  .catch((e) => { console.error('❌ 스크립트 실패:', e); process.exit(1); });
