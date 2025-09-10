/* eslint-disable no-console */
// scripts/delegateTestFunc.js
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const hre = require('hardhat');
const { ethers } = hre;

// selector 계산 (ethers v6)
function selectorFromEncode(iface, fnName, exampleArgs) {
    const encoded = iface.encodeFunctionData(fnName, exampleArgs);
    return encoded.slice(0, 10);
}
function loadJSON(relPath) {
    const abs = path.resolve(__dirname, relPath);
    if (!fs.existsSync(abs)) throw new Error(`❌ 파일을 찾을 수 없습니다: ${abs}`);
    return JSON.parse(fs.readFileSync(abs, 'utf8'));
}

async function main() {
    // ---- env ----
    const { PRIVATE_KEY, OWNER_KEY } = process.env; // PRIVATE_KEY=서명자, OWNER_KEY=릴레이어
    if (!PRIVATE_KEY || !OWNER_KEY) {
        throw new Error("❌ .env에 PRIVATE_KEY(서명자) / OWNER_KEY(릴레이어) 를 설정하세요.");
    }

    // ---- load addresses & params ----
    const deployInfo = loadJSON('./output/deployment-info.json');
    const forwarderAddress = deployInfo.forwarder;
    const vestingAddress   = deployInfo.contracts?.tokenVesting;

    if (!forwarderAddress || !vestingAddress) {
        throw new Error("❌ deployment-info.json에서 forwarder 또는 contracts.tokenVesting 주소를 찾지 못했습니다.");
    }

    const metaCfg = loadJSON('./data/delegateTestFunc.json'); // { deadline, gas_call, gas_execute }
    const gasCall    = BigInt(metaCfg.gas_call ?? 1_500_000);
    const gasExecute = BigInt(metaCfg.gas_execute ?? 3_000_000);
    const deadlineIn = Number(metaCfg.deadline ?? 3600);

    // ---- provider & wallets ----
    const net = await hre.ethers.provider.getNetwork();
    const chainId = Number(net.chainId);

    const signer  = new ethers.Wallet(PRIVATE_KEY, hre.ethers.provider); // _msgSender()
    const relayer = new ethers.Wallet(OWNER_KEY, hre.ethers.provider);   // 가스 지불자

    console.log(`🔗 Network: chainId=${chainId} (${net.name})`);
    console.log(`🧭 Forwarder: ${forwarderAddress}`);
    console.log(`📦 TokenVesting: ${vestingAddress}`);
    console.log(`👤 Signer(from / _msgSender): ${signer.address}`);
    console.log(`🚚 Relayer(tx sender / gas payer): ${relayer.address}`);
    console.log(`⛽ gas_call=${gasCall}  gas_execute=${gasExecute}  deadline(+secs)=${deadlineIn}`);

    // ---- load ABIs via factories ----
    const FwdFactory     = await ethers.getContractFactory('WhitelistForwarder', relayer);
    const VestingFactory = await ethers.getContractFactory('TokenVesting', signer);

    const forwarder    = FwdFactory.attach(forwarderAddress);
    const vestingIface = VestingFactory.interface;

    // ---- encode call & selector (testFunc) ----
    const callData = vestingIface.encodeFunctionData('testFunc', []);
    const selector = selectorFromEncode(vestingIface, 'testFunc', []);
    console.log(`🔑 selector(testFunc): ${selector}`);

    // ---- (optional) allow-list 확인 ----
    try {
        const [_selEcho, allowed] = await forwarder.debugAllowed(vestingAddress, callData);
        console.log(`🛡️  Forwarder allow-list for selector ${selector}: ${allowed ? "ALLOWED ✅" : "NOT ALLOWED ❌"}`);
        if (!allowed) {
            const fOwner = await forwarder.owner();
            console.log(`   • Forwarder owner: ${fOwner}`);
            console.log("   • setAllowed(vestingAddress, selector, true)를 먼저 설정하세요.");
        }
    } catch {
        console.log("ℹ️  debugAllowed 호출 불가(ABI/권한 차이일 수 있음) - 계속 진행합니다.");
    }

    // ---- nonce & deadline ----
    let nonce;
    try {
        nonce = await forwarder.getNonce(signer.address);
    } catch {
        nonce = await forwarder.nonces(signer.address);
    }
    nonce = BigInt(nonce.toString());
    const now = Math.floor(Date.now() / 1000);
    const deadline = now + deadlineIn; // uint48

    // ---- EIP-712 domain & types (WhitelistForwarder / OZ ERC2771Forwarder) ----
    const domain = {
        name: "WhitelistForwarder",
        version: "1",
        chainId,
        verifyingContract: forwarderAddress,
    };
    // const types = {
    //     ForwardRequestData: [
    //         { name: "from",     type: "address"  },
    //         { name: "to",       type: "address"  },
    //         { name: "value",    type: "uint256"  },
    //         { name: "gas",      type: "uint256"  }, // 내부 call 가스
    //         { name: "nonce",    type: "uint256"  },
    //         { name: "deadline", type: "uint48"   },
    //         { name: "data",     type: "bytes"    },
    //     ],
    // };
    const types = {
        ForwardRequest: [
            { name: "from",     type: "address"  },
            { name: "to",       type: "address"  },
            { name: "value",    type: "uint256"  },
            { name: "gas",      type: "uint256"  }, // 내부 call 가스
            { name: "nonce",    type: "uint256"  },
            { name: "deadline", type: "uint48"   },
            { name: "data",     type: "bytes"    },
        ],
    };

    // ---- request ----
    const request = {
        from: signer.address,   // _msgSender()
        to: vestingAddress,
        value: 0n,
        gas: gasCall,           // forwarder가 target.call 할 때 전달될 가스
        nonce,
        deadline,
        data: callData,
    };

    // ---- sign & execute ----
    const signature = await signer.signTypedData(domain, types, request);
    console.log(`✍️  EIP-712 signature: ${signature.slice(0, 10)}...`);
    const requestWithSig = { ...request, signature };

    try {
        const ds = await forwarder.domainSeparator();
        console.log(`📎 forwarder.domainSeparator: ${ds}`);
    } catch {}

    const recovered = ethers.verifyTypedData(domain, types, request, signature);
    console.log("🔍 recovered:", recovered, " expected:", signer.address);


    console.log("🚀 Sending execute(request) via relayer...");
    const tx = await forwarder.execute(requestWithSig, {
        value: request.value,  // 0
        gasLimit: gasExecute,  // 트xn gas 상한
    });
    console.log(`⏳ Tx sent: ${tx.hash}`);
    const rc = await tx.wait();
    console.log(`✅ Executed! status=${rc.status} block=${rc.blockNumber}`);
    console.log("🎉 testFunc() meta-tx 완료(위임대납).");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
