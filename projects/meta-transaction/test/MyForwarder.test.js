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

describe("MyWhitelistForwarder", function () {
  let whitelistForwarder, receiver, user, relayer, owner;
  let domain;

  beforeEach(async function () {
    [user, relayer, owner] = await ethers.getSigners();

    const MyWhitelistForwarder = await ethers.getContractFactory("MyWhitelistForwarder");
    whitelistForwarder = await MyWhitelistForwarder.connect(owner).deploy();

    const MetaTxReceiver = await ethers.getContractFactory("MetaTxReceiver");
    receiver = await MetaTxReceiver.deploy(await whitelistForwarder.getAddress());

    const net = await user.provider.getNetwork();
    domain = {
      name: "MyDefaultForwarder",
      version: "1",
      chainId: Number(net.chainId),
      verifyingContract: await whitelistForwarder.getAddress(),
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
    const nonce = await whitelistForwarder.nonces(signer.address);
    const forSigning = {
      from: reqToSend.from,
      to: reqToSend.to,
      value: reqToSend.value,
      gas: reqToSend.gas,
      nonce,
      deadline: reqToSend.deadline,
      data: reqToSend.data,
    };
    const signature = await signer.signTypedData(domain, EIP712_TYPES, forSigning);
    return { ...reqToSend, signature };
  }

  describe("Whitelist Management", function () {
    it("should have correct initial owner", async function () {
      expect(await whitelistForwarder.owner()).to.equal(owner.address);
    });

    it("should allow owner to add address to whitelist", async function () {
      const targetAddress = await receiver.getAddress();
      
      await expect(whitelistForwarder.connect(owner).addToWhitelist(targetAddress))
        .to.emit(whitelistForwarder, "WhitelistAdded")
        .withArgs(targetAddress, owner.address);
      
      expect(await whitelistForwarder.isWhitelisted(targetAddress)).to.be.true;
    });

    it("should allow owner to remove address from whitelist", async function () {
      const targetAddress = await receiver.getAddress();
      
      // 먼저 추가
      await whitelistForwarder.connect(owner).addToWhitelist(targetAddress);
      
      // 제거
      await expect(whitelistForwarder.connect(owner).removeFromWhitelist(targetAddress))
        .to.emit(whitelistForwarder, "WhitelistRemoved")
        .withArgs(targetAddress, owner.address);
      
      expect(await whitelistForwarder.isWhitelisted(targetAddress)).to.be.false;
    });

    it("should allow owner to add multiple addresses to whitelist", async function () {
      const addresses = [await receiver.getAddress(), user.address, relayer.address];
      
      await expect(whitelistForwarder.connect(owner).addBatchToWhitelist(addresses))
        .to.emit(whitelistForwarder, "WhitelistAdded")
        .withArgs(await receiver.getAddress(), owner.address)
        .and.to.emit(whitelistForwarder, "WhitelistAdded")
        .withArgs(user.address, owner.address)
        .and.to.emit(whitelistForwarder, "WhitelistAdded")
        .withArgs(relayer.address, owner.address);
      
      for (const addr of addresses) {
        expect(await whitelistForwarder.isWhitelisted(addr)).to.be.true;
      }
    });

    it("should allow owner to remove multiple addresses from whitelist", async function () {
      const addresses = [await receiver.getAddress(), user.address, relayer.address];
      
      // 먼저 추가
      await whitelistForwarder.connect(owner).addBatchToWhitelist(addresses);
      
      // 제거
      await expect(whitelistForwarder.connect(owner).removeBatchFromWhitelist(addresses))
        .to.emit(whitelistForwarder, "WhitelistRemoved")
        .withArgs(await receiver.getAddress(), owner.address)
        .and.to.emit(whitelistForwarder, "WhitelistRemoved")
        .withArgs(user.address, owner.address)
        .and.to.emit(whitelistForwarder, "WhitelistRemoved")
        .withArgs(relayer.address, owner.address);
      
      for (const addr of addresses) {
        expect(await whitelistForwarder.isWhitelisted(addr)).to.be.false;
      }
    });

    it("should revert when non-owner tries to add to whitelist", async function () {
      const targetAddress = await receiver.getAddress();
      
      await expect(
        whitelistForwarder.connect(user).addToWhitelist(targetAddress)
      ).to.be.revertedWithCustomError(whitelistForwarder, "NotOwner");
    });

    it("should revert when non-owner tries to remove from whitelist", async function () {
      const targetAddress = await receiver.getAddress();
      
      // 먼저 추가
      await whitelistForwarder.connect(owner).addToWhitelist(targetAddress);
      
      // 제거 시도
      await expect(
        whitelistForwarder.connect(user).removeFromWhitelist(targetAddress)
      ).to.be.revertedWithCustomError(whitelistForwarder, "NotOwner");
    });

    it("should revert when trying to add zero address to whitelist", async function () {
      await expect(
        whitelistForwarder.connect(owner).addToWhitelist(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(whitelistForwarder, "InvalidAddress");
    });

    it("should revert when trying to remove zero address from whitelist", async function () {
      await expect(
        whitelistForwarder.connect(owner).removeFromWhitelist(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(whitelistForwarder, "InvalidAddress");
    });
  });

  describe("Ownership Management", function () {
    it("should allow owner to transfer ownership", async function () {
      const newOwner = user.address;
      
      await expect(whitelistForwarder.connect(owner).transferOwnership(newOwner))
        .to.emit(whitelistForwarder, "OwnershipTransferred")
        .withArgs(owner.address, newOwner);
      
      expect(await whitelistForwarder.owner()).to.equal(newOwner);
    });

    it("should allow owner to renounce ownership", async function () {
      await expect(whitelistForwarder.connect(owner).renounceOwnership())
        .to.emit(whitelistForwarder, "OwnershipTransferred")
        .withArgs(owner.address, ethers.ZeroAddress);
      
      expect(await whitelistForwarder.owner()).to.equal(ethers.ZeroAddress);
    });

    it("should revert when non-owner tries to transfer ownership", async function () {
      const newOwner = user.address;
      
      await expect(
        whitelistForwarder.connect(user).transferOwnership(newOwner)
      ).to.be.revertedWithCustomError(whitelistForwarder, "NotOwner");
    });

    it("should revert when non-owner tries to renounce ownership", async function () {
      await expect(
        whitelistForwarder.connect(user).renounceOwnership()
      ).to.be.revertedWithCustomError(whitelistForwarder, "NotOwner");
    });

    it("should revert when trying to transfer ownership to zero address", async function () {
      await expect(
        whitelistForwarder.connect(owner).transferOwnership(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(whitelistForwarder, "InvalidAddress");
    });
  });

  describe("Execute with Whitelist", function () {
    beforeEach(async function () {
      // receiver를 whitelist에 추가
      await whitelistForwarder.connect(owner).addToWhitelist(await receiver.getAddress());
    });

    it("should execute meta-tx successfully when target is whitelisted", async function () {
      const message = "Hello Whitelist";
      const data = receiver.interface.encodeFunctionData("setMessage", [message]);

      const req = await buildRequestToSend(user, await receiver.getAddress(), 0, data);
      const signed = await signForForwarder(user, req);

      await expect(whitelistForwarder.connect(relayer).execute(signed, { gasLimit: 2_000_000 }))
        .to.not.be.reverted;

      expect(await receiver.message()).to.equal(message);
    });

    it("should revert when target is not whitelisted", async function () {
      // receiver를 whitelist에서 제거
      await whitelistForwarder.connect(owner).removeFromWhitelist(await receiver.getAddress());
      
      const message = "Hello World";
      const data = receiver.interface.encodeFunctionData("setMessage", [message]);

      const req = await buildRequestToSend(user, await receiver.getAddress(), 0, data);
      const signed = await signForForwarder(user, req);

      await expect(
        whitelistForwarder.connect(relayer).execute(signed, { gasLimit: 2_000_000 })
      ).to.be.revertedWithCustomError(whitelistForwarder, "NotWhitelisted")
        .withArgs(await receiver.getAddress());
    });

    it("should revert when target is never added to whitelist", async function () {
      const message = "Hello World";
      const data = receiver.interface.encodeFunctionData("setMessage", [message]);

      const req = await buildRequestToSend(user, user.address, 0, data); // user.address는 whitelist에 없음
      const signed = await signForForwarder(user, req);

      await expect(
        whitelistForwarder.connect(relayer).execute(signed, { gasLimit: 2_000_000 })
      ).to.be.revertedWithCustomError(whitelistForwarder, "NotWhitelisted")
        .withArgs(user.address);
    });

    it("should maintain revert reason bubbling for whitelisted targets", async function () {
      const data = receiver.interface.encodeFunctionData("setMessage", ["revert1"]);
      const req = await buildRequestToSend(user, await receiver.getAddress(), 0, data);
      const signed = await signForForwarder(user, req);

      await expect(whitelistForwarder.connect(relayer).execute(signed, { gasLimit: 2_000_000 }))
        .to.be.revertedWith("revert1");
    });

    it("should emit ExecutedForwardRequest on successful execution", async function () {
      const message = "Hello World";
      const data = receiver.interface.encodeFunctionData("setMessage", [message]);

      const req = await buildRequestToSend(user, await receiver.getAddress(), 0, data);
      const signed = await signForForwarder(user, req);

      await expect(whitelistForwarder.connect(relayer).execute(signed, { gasLimit: 2_000_000 }))
        .to.emit(whitelistForwarder, "ExecutedForwardRequest")
        .withArgs(user.address, 0n, true);
    });

    it("should handle value mismatch correctly", async function () {
      const message = "Hello World";
      const data = receiver.interface.encodeFunctionData("setMessage", [message]);

      const req = await buildRequestToSend(user, await receiver.getAddress(), ethers.parseEther("1"), data);
      const signed = await signForForwarder(user, req);

      await expect(
        whitelistForwarder.connect(relayer).execute(signed, { value: 0, gasLimit: 2_000_000 })
      ).to.be.revertedWithCustomError(whitelistForwarder, "ERC2771ForwarderMismatchedValue");
    });

    it("should handle invalid signature correctly", async function () {
      const message = "Hello World";
      const data = receiver.interface.encodeFunctionData("setMessage", [message]);

      const req = await buildRequestToSend(user, await receiver.getAddress(), 0, data);
      req.signature = "0x1234567890abcdef"; // 잘못된 서명

      await expect(
        whitelistForwarder.connect(relayer).execute(req, { gasLimit: 2_000_000 })
      ).to.be.revertedWithCustomError(whitelistForwarder, "ERC2771ForwarderInvalidSigner");
    });

    it("should handle expired request correctly", async function () {
      const message = "Hello World";
      const data = receiver.interface.encodeFunctionData("setMessage", [message]);

      const req = await buildRequestToSend(user, await receiver.getAddress(), 0, data);
      req.deadline = Math.floor(Date.now() / 1000) - 3600; // 지난 시간
      const signed = await signForForwarder(user, req);

      await expect(
        whitelistForwarder.connect(relayer).execute(signed, { gasLimit: 2_000_000 })
      ).to.be.revertedWithCustomError(whitelistForwarder, "ERC2771ForwarderExpiredRequest");
    });
  });

  describe("Integration Tests", function () {
    it("should work correctly after ownership transfer", async function () {
      // 새로운 소유자에게 권한 이전
      await whitelistForwarder.connect(owner).transferOwnership(user.address);
      
      // 새로운 소유자가 whitelist 관리
      await whitelistForwarder.connect(user).addToWhitelist(await receiver.getAddress());
      
      // 메타트랜잭션 실행
      const message = "Hello New Owner";
      const data = receiver.interface.encodeFunctionData("setMessage", [message]);

      const req = await buildRequestToSend(relayer, await receiver.getAddress(), 0, data);
      const signed = await signForForwarder(relayer, req);

      await expect(whitelistForwarder.connect(owner).execute(signed, { gasLimit: 2_000_000 }))
        .to.not.be.reverted;

      expect(await receiver.message()).to.equal(message);
    });

    it("should maintain whitelist after ownership renounce", async function () {
      // receiver를 whitelist에 추가
      await whitelistForwarder.connect(owner).addToWhitelist(await receiver.getAddress());
      
      // 소유권 포기
      await whitelistForwarder.connect(owner).renounceOwnership();
      
      // whitelist 상태 유지 확인
      expect(await whitelistForwarder.isWhitelisted(await receiver.getAddress())).to.be.true;
      
      // 메타트랜잭션 실행 (여전히 작동해야 함)
      const message = "Hello After Renounce";
      const data = receiver.interface.encodeFunctionData("setMessage", [message]);

      const req = await buildRequestToSend(user, await receiver.getAddress(), 0, data);
      const signed = await signForForwarder(user, req);

      await expect(whitelistForwarder.connect(relayer).execute(signed, { gasLimit: 2_000_000 }))
        .to.not.be.reverted;

      expect(await receiver.message()).to.equal(message);
    });
  });
});
