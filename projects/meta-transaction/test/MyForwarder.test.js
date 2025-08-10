const { expect } = require("chai");
const { ethers } = require("hardhat");


describe("MyDefaultForwarder", function () {
  let forwarder, receiver, user, relayer;
  let domain;

  beforeEach(async function () {
    [user, relayer] = await ethers.getSigners();

    const MyDefaultForwarder = await ethers.getContractFactory("MyDefaultForwarder");
    forwarder = await MyDefaultForwarder.deploy();

    const MetaTxReceiver = await ethers.getContractFactory("MetaTxReceiver");
    receiver = await MetaTxReceiver.deploy(await forwarder.getAddress());

    const net = await user.provider.getNetwork();
    domain = {
      name: "MyDefaultForwarder",
      version: "1",
      chainId: Number(net.chainId), // ethers v6는 bigint -> number 변환 필요
      verifyingContract: await forwarder.getAddress(),
    };
  });

  // EIP-712 타입: nonce 포함, deadline은 uint48 이어야 함
  const EIP712_TYPES = {
    ForwardRequest: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "gas", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint48" },
      { name: "data", type: "bytes" },
    ],
  };

  async function buildRequestToSend(from, to, value, data, gas = 300_000) {
    const deadline = Math.floor(Date.now() / 1000) + 3600; // +1h
    return {
      from: from.address,
      to,
      value,
      gas,
      deadline,
      data,
      signature: "0x",
    };
  }

  async function signForForwarder(signer, reqToSend) {
    // 서명에는 nonce가 필요하지만, execute에 넘기는 struct에는 넣지 않음
    const nonce = await forwarder.nonces(signer.address);
    const forSigning = {
      from: reqToSend.from,
      to: reqToSend.to,
      value: reqToSend.value,
      gas: reqToSend.gas,
      nonce, // EIP-712에만 포함
      deadline: reqToSend.deadline,
      data: reqToSend.data,
    };
    const signature = await signer.signTypedData(domain, EIP712_TYPES, forSigning);
    return { ...reqToSend, signature };
  }

  // 헬퍼: 명시적 nonce로 서명
    async function signForForwarderWithNonce(signer, reqToSend, explicitNonce) {
        const forSigning = {
        from: reqToSend.from,
        to: reqToSend.to,
        value: reqToSend.value,
        gas: reqToSend.gas,
        nonce: explicitNonce,            // <-- 여기!
        deadline: reqToSend.deadline,
        data: reqToSend.data,
        };
        const signature = await signer.signTypedData(domain, EIP712_TYPES, forSigning);
        return { ...reqToSend, signature };
    }
  

  describe("execute", function () {
    it("executes the meta-tx successfully and updates message", async function () {
      const message = "Hello World";
      const data = receiver.interface.encodeFunctionData("setMessage", [message]);

      const req = await buildRequestToSend(user, await receiver.getAddress(), 0, data);
      const signed = await signForForwarder(user, req);

      await expect(forwarder.connect(relayer).execute(signed, { gasLimit: 2_000_000 }))
        .to.not.be.reverted;

      expect(await receiver.message()).to.equal(message);
    });

    it("reverts on invalid signature", async function () {
      const message = "Hello World";
      const data = receiver.interface.encodeFunctionData("setMessage", [message]);

      const req = await buildRequestToSend(user, await receiver.getAddress(), 0, data);
      req.signature = "0x1234567890abcdef"; // 잘못된 서명

      await expect(forwarder.connect(relayer).execute(req, { gasLimit: 2_000_000 }))
        .to.be.revertedWithCustomError(forwarder, "ERC2771ForwarderInvalidSigner");
    });

    it("reverts on expired request", async function () {
      const message = "Hello World";
      const data = receiver.interface.encodeFunctionData("setMessage", [message]);

      const req = await buildRequestToSend(user, await receiver.getAddress(), 0, data);
      req.deadline = Math.floor(Date.now() / 1000) - 3600; // 지난 시간
      const signed = await signForForwarder(user, req);

      await expect(forwarder.connect(relayer).execute(signed, { gasLimit: 2_000_000 }))
        .to.be.revertedWithCustomError(forwarder, "ERC2771ForwarderExpiredRequest");
    });

    it("bubbles revert reason from target (revert1)", async function () {
      const data = receiver.interface.encodeFunctionData("setMessage", ["revert1"]);
      const req = await buildRequestToSend(user, await receiver.getAddress(), 0, data);
      const signed = await signForForwarder(user, req);

      await expect(forwarder.connect(relayer).execute(signed, { gasLimit: 2_000_000 }))
        .to.be.revertedWith("revert1");
    });

    it("bubbles revert reason from target (revert2)", async function () {
      const data = receiver.interface.encodeFunctionData("setMessage", ["revert2"]);
      const req = await buildRequestToSend(user, await receiver.getAddress(), 0, data);
      const signed = await signForForwarder(user, req);

      await expect(forwarder.connect(relayer).execute(signed, { gasLimit: 2_000_000 }))
        .to.be.revertedWith("revert2");
    });

    it("emits ExecutedForwardRequest on success", async function () {
      const message = "Hello World";
      const data = receiver.interface.encodeFunctionData("setMessage", [message]);

      const req = await buildRequestToSend(user, await receiver.getAddress(), 0, data);
      const signed = await signForForwarder(user, req);

      await expect(forwarder.connect(relayer).execute(signed, { gasLimit: 2_000_000 }))
        .to.emit(forwarder, "ExecutedForwardRequest")
        .withArgs(user.address, 0n, true); // signer, nonce, success
    });
  });

  describe("executeBatch", function () {
    it("executes a batch of meta-transactions (both succeed)", async function () {
        const m1 = "Hello 1";
        const m2 = "Hello 2";
        const d1 = receiver.interface.encodeFunctionData("setMessage", [m1]);
        const d2 = receiver.interface.encodeFunctionData("setMessage", [m2]);
      
        const base = await forwarder.nonces(user.address); // N
        const r1Unsigned = await buildRequestToSend(user, await receiver.getAddress(), 0, d1);
        const r2Unsigned = await buildRequestToSend(user, await receiver.getAddress(), 0, d2);
      
        const r1 = await signForForwarderWithNonce(user, r1Unsigned, base);       // N
        const r2 = await signForForwarderWithNonce(user, r2Unsigned, base + 1n);  // N+1 (ethers v6 bigint)
      
        const tx = await forwarder.connect(relayer).executeBatch([r1, r2], ethers.ZeroAddress, { gasLimit: 3_000_000 });
      
        await expect(tx).to.emit(forwarder, "ExecutedForwardRequest").withArgs(user.address, base, true);
        await expect(tx).to.emit(forwarder, "ExecutedForwardRequest").withArgs(user.address, base + 1n, true);
      
        expect(await receiver.message()).to.equal(m2);
    });
      

    it("does NOT revert when one inner call reverts; emits success=false for that item", async function () {
        const m1 = "Hello 1";
        const d1 = receiver.interface.encodeFunctionData("setMessage", [m1]);
        const d2 = receiver.interface.encodeFunctionData("setMessage", ["revert1"]);
      
        const base = await forwarder.nonces(user.address); // N
        const r1Unsigned = await buildRequestToSend(user, await receiver.getAddress(), 0, d1);
        const r2Unsigned = await buildRequestToSend(user, await receiver.getAddress(), 0, d2);
      
        const r1 = await signForForwarderWithNonce(user, r1Unsigned, base);       // N
        const r2 = await signForForwarderWithNonce(user, r2Unsigned, base + 1n);  // N+1
      
        const tx = await forwarder.connect(relayer).executeBatch([r1, r2], ethers.ZeroAddress, { gasLimit: 3_000_000 });
      
        await expect(tx).to.emit(forwarder, "ExecutedForwardRequest").withArgs(user.address, base, true);
        await expect(tx).to.emit(forwarder, "ExecutedForwardRequest").withArgs(user.address, base + 1n, false);
      
        expect(await receiver.message()).to.equal(m1);
    });
      

    it("reverts when msg.value mismatches total requested value", async function () {
      const message = "Hello World";
      const data = receiver.interface.encodeFunctionData("setMessage", [message]);

      const r = await signForForwarder(user, await buildRequestToSend(user, await receiver.getAddress(), ethers.parseEther("1"), data));

      await expect(
        forwarder.connect(relayer).executeBatch([r], ethers.ZeroAddress, { value: 0, gasLimit: 2_000_000 })
      ).to.be.revertedWithCustomError(forwarder, "ERC2771ForwarderMismatchedValue");
    });
  });

  describe("domain separator", function () {
    it("returns correct domain separator", async function () {
      const expectedDomain = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["bytes32", "bytes32", "bytes32", "uint256", "address"],
          [
            ethers.keccak256(
              ethers.toUtf8Bytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
            ),
            ethers.keccak256(ethers.toUtf8Bytes("MyDefaultForwarder")),
            ethers.keccak256(ethers.toUtf8Bytes("1")),
            Number((await user.provider.getNetwork()).chainId),
            await forwarder.getAddress()
          ]
        )
      );
      expect(await forwarder.domainSeparator()).to.equal(expectedDomain);
    });
  });
});
