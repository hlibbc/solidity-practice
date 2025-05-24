const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MyDefaultForwarder", function () {
    let forwarder;
    let receiver;
    let relayer;
    let user;
    let signer;

    beforeEach(async function () {
        [user, relayer, signer] = await ethers.getSigners();

        const Forwarder = await ethers.getContractFactory("MyDefaultForwarder");
        const Receiver = await ethers.getContractFactory("MetaTxReceiver");

        forwarder = await Forwarder.deploy();
        await forwarder.waitForDeployment();
        receiver = await Receiver.deploy(await forwarder.getAddress());
        await receiver.waitForDeployment();
    });

    function getDomain(forwarder, chainId) {
        return {
            name: "MyDefaultForwarder",
            version: "1",
            chainId,
            verifyingContract: forwarder,
        };
    }

    const types = {
        ForwardRequest: [
            { name: "from", type: "address" },
            { name: "to", type: "address" },
            { name: "value", type: "uint256" },
            { name: "gas", type: "uint256" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint48" },
            { name: "data", type: "bytes" },
        ]
    };

    async function buildRequest(signer, to, value, data, overrideNonce = null, overrideDeadline = null) {
        const nonce = overrideNonce !== null ? overrideNonce : await forwarder.nonces(signer.address);
        const deadline = overrideDeadline !== null ? overrideDeadline : Math.floor(Date.now() / 1000) + 600;
        return {
            from: signer.address,
            to,
            value,
            gas: 100000,
            nonce,
            deadline,
            data,
        };
    }

    async function signRequest(signer, domain, request) {
        const signature = await signer.signTypedData(domain, types, request);
        return { ...request, signature };
    }

    describe("execute", function () {
        it("should execute the meta-transaction successfully", async function () {
            const message = "Hello, world!";
            const data = receiver.interface.encodeFunctionData("setMessage", [message]);

            const request = await buildRequest(user, await receiver.getAddress(), 0, data);
            const domain = getDomain(await forwarder.getAddress(), await user.provider.getNetwork().then(n => n.chainId));
            const signed = await signRequest(user, domain, request);

            await expect(forwarder.connect(relayer).execute(signed)).to.emit(forwarder, "ExecutedForwardRequest");
            expect(await receiver.message()).to.equal(message);
        });

        it("should revert if the signature is invalid", async function () {
            const message = "Invalid sig test!";
            const data = receiver.interface.encodeFunctionData("setMessage", [message]);

            const request = await buildRequest(user, await receiver.getAddress(), 0, data);
            const domain = getDomain(await forwarder.getAddress(), await user.provider.getNetwork().then(n => n.chainId));
            const signed = await signRequest(signer, domain, request);

            await expect(forwarder.connect(relayer).execute(signed)).to.be.revertedWithCustomError(forwarder, "ERC2771ForwarderInvalidSigner");
        });

        it("should revert if the request has expired", async function () {
            const message = "Expired!";
            const data = receiver.interface.encodeFunctionData("setMessage", [message]);

            const nonce = await forwarder.nonces(user.address);
            const request = {
                from: user.address,
                to: await receiver.getAddress(),
                value: 0,
                gas: 100000,
                nonce,
                deadline: Math.floor(Date.now() / 1000) - 10,
                data,
            };
            const domain = getDomain(await forwarder.getAddress(), await user.provider.getNetwork().then(n => n.chainId));
            const signed = await signRequest(user, domain, request);

            await expect(forwarder.connect(relayer).execute(signed)).to.be.revertedWithCustomError(forwarder, "ERC2771ForwarderExpiredRequest");
        });
    });

    describe("executeBatch", function () {
        it("should execute a batch of meta-transactions", async function () {
            const value = 2000n;

            const data1 = receiver.interface.encodeFunctionData("setMessage", ["Batch #1"]);
            const data2 = receiver.interface.encodeFunctionData("setMessage", ["Batch #2"]);


            const nonce = await forwarder.nonces(user.address);
            const request1 = await buildRequest(user, await receiver.getAddress(), value, data1, nonce);
            const request2 = await buildRequest(user, await receiver.getAddress(), value, data2, nonce + 1n);

            const domain = getDomain(await forwarder.getAddress(), await user.provider.getNetwork().then(n => n.chainId));
            const signed1 = await signRequest(user, domain, request1);
            const signed2 = await signRequest(user, domain, request2);

            const totalValue = signed1.value + signed2.value;

            const batch = [signed1, signed2];

            await forwarder.connect(relayer).executeBatch(batch, relayer.address, { value: totalValue });
            const finalMessage = await receiver.message();
            expect(finalMessage).to.equal("Batch #2");
        });

        it("should refund value for failed requests in batch", async function () {
            // Deploy Refunder contract
            const Refunder = await ethers.getContractFactory("Refunder");
            const refunder = await Refunder.deploy();
            await refunder.waitForDeployment();
        
            const value = 2000n;
        
            const data1 = receiver.interface.encodeFunctionData("setMessage", ["Batch 1"]);
            const data2 = "0xdeadbeef"; // Invalid call to cause failure
        
            const nonce = await forwarder.nonces(user.address);
            const request1 = await buildRequest(user, await receiver.getAddress(), value, data1, nonce);
            const request2 = await buildRequest(user, await receiver.getAddress(), value, data2, nonce + 1n);
        
            const domain = getDomain(await forwarder.getAddress(), await user.provider.getNetwork().then(n => n.chainId));
            const signed1 = await signRequest(user, domain, request1);
            const signed2 = await signRequest(user, domain, request2);
        
            const totalValue = signed1.value + signed2.value;
        
            const before = await ethers.provider.getBalance(await refunder.getAddress());
        
            await forwarder.connect(relayer).executeBatch(
                [signed1, signed2],
                await refunder.getAddress(),
                { value: totalValue }
            );
        
            const after = await ethers.provider.getBalance(await refunder.getAddress());
            const refunded = after - before;
            
            expect(refunded).to.equal(value); // 하나는 실패했으니 value 하나만 환불됨
        });
        

        it("should revert if msg.value does not match request total", async function () {
            const data1 = receiver.interface.encodeFunctionData("setMessage", ["Mismatch"]);

            const request = await buildRequest(user, await receiver.getAddress(), 1000, data1);
            const domain = getDomain(await forwarder.getAddress(), await user.provider.getNetwork().then(n => n.chainId));
            const signed = await signRequest(user, domain, request);

            await expect(
                forwarder.connect(relayer).executeBatch([signed], relayer.address, { value: 0 })
            ).to.be.revertedWithCustomError(forwarder, "ERC2771ForwarderMismatchedValue");
        });
    });
});

