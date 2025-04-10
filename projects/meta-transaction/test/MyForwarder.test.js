const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MyForwarder", function () {
    let forwarder;
    let receiver;
    let relayer;
    let user;
    let signer;
    const value = ethers.parseUnits("1", "ether"); // parseEther -> parseUnits 사용

    beforeEach(async function () {
        [user, relayer, signer] = await ethers.getSigners();

        // Deploy MyForwarder and MetaTxReceiver contracts
        const Forwarder = await ethers.getContractFactory("MyForwarder");
        const Receiver = await ethers.getContractFactory("MetaTxReceiver");

        console.log('111')
        forwarder = await Forwarder.deploy();
        await forwarder.waitForDeployment();
        console.log('222')
        receiver = await Receiver.deploy(await forwarder.getAddress());
        console.log('333')
        await receiver.waitForDeployment();
        console.log(await forwarder.getAddress())
        console.log(await receiver.getAddress())

        // Set the receiver contract address in forwarder
        // Ensure the forwarder has the receiver address set correctly
        // await forwarder.setReceiverAddress(receiver.address);

        // No need to add relayer manually, as it's done in the contract itself
    });

    describe("execute", function () {
        it("should execute the meta-transaction successfully", async function () {
            const message = "Hello, world!";
            const data = receiver.interface.encodeFunctionData("setMessage", [message]);

            // Sign the transaction
            const nonce = await forwarder.nonces(user.address);
            const deadline = Math.floor(Date.now() / 1000) + 600; // 10 minutes from now
            const request = {
                from: user.address,
                to: receiver.address,
                value: 0,
                gas: 100000,
                nonce,
                deadline,
                data,
            };

            const domain = {
                name: "MyForwarder",
                version: "1",
                chainId: await ethers.provider.getNetwork().then((n) => n.chainId),
                verifyingContract: forwarder.address,
            };

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

            // Sign the request
            const signature = await user.signTypedData(domain, types, request);
            request.signature = signature;

            // Execute the meta-transaction
            await expect(
                forwarder.connect(relayer).execute(request)
            ).to.emit(forwarder, "ExecutedForwardRequest");

            const storedMessage = await receiver.message();
            expect(storedMessage).to.equal(message);
        });

        it("should revert if the signature is invalid", async function () {
            const message = "Hello, world!";
            const data = receiver.interface.encodeFunctionData("setMessage", [message]);

            const nonce = await forwarder.nonces(user.address);
            const deadline = Math.floor(Date.now() / 1000) + 600; // 10 minutes from now
            const request = {
                from: user.address,
                to: receiver.address,
                value: 0,
                gas: 100000,
                nonce,
                deadline,
                data,
            };

            const domain = {
                name: "MyForwarder",
                version: "1",
                chainId: await ethers.provider.getNetwork().then((n) => n.chainId),
                verifyingContract: forwarder.address,
            };

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

            // Sign the request with a different user
            const signature = await signer.signTypedData(domain, types, request);
            request.signature = signature;

            // Try executing with the invalid signature
            await expect(
                forwarder.connect(relayer).execute(request)
            ).to.be.revertedWith(
                "ERC2771ForwarderInvalidSigner: Signer does not match the provided address"
            );
        });

        it("should revert if the request has expired", async function () {
            const message = "Hello, world!";
            const data = receiver.interface.encodeFunctionData("setMessage", [message]);

            const nonce = await forwarder.nonces(user.address);
            const deadline = Math.floor(Date.now() / 1000) - 600; // 10 minutes ago (expired)
            const request = {
                from: user.address,
                to: receiver.address,
                value: 0,
                gas: 100000,
                nonce,
                deadline,
                data,
            };

            const domain = {
                name: "MyForwarder",
                version: "1",
                chainId: await ethers.provider.getNetwork().then((n) => n.chainId),
                verifyingContract: forwarder.address,
            };

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

            const signature = await user.signTypedData(domain, types, request);
            request.signature = signature;

            // Try executing with an expired deadline
            await expect(
                forwarder.connect(relayer).execute(request)
            ).to.be.revertedWith("ERC2771ForwarderExpiredRequest: Request expired");
        });
    });

    describe("executeBatch", function () {
        it("should execute a batch of meta-transactions", async function () {
            const message1 = "Message 1";
            const data1 = receiver.interface.encodeFunctionData("setMessage", [message1]);

            const message2 = "Message 2";
            const data2 = receiver.interface.encodeFunctionData("setMessage", [message2]);

            const nonce1 = await forwarder.nonces(user.address);
            const nonce2 = nonce1.add(1);

            const request1 = {
                from: user.address,
                to: receiver.address,
                value: 0,
                gas: 100000,
                nonce: nonce1,
                deadline: Math.floor(Date.now() / 1000) + 600,
                data: data1,
            };

            const request2 = {
                from: user.address,
                to: receiver.address,
                value: 0,
                gas: 100000,
                nonce: nonce2,
                deadline: Math.floor(Date.now() / 1000) + 600,
                data: data2,
            };

            const domain = {
                name: "MyForwarder",
                version: "1",
                chainId: await ethers.provider.getNetwork().then((n) => n.chainId),
                verifyingContract: forwarder.address,
            };

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

            const signature1 = await user.signTypedData(domain, types, request1);
            const signature2 = await user.signTypedData(domain, types, request2);

            request1.signature = signature1;
            request2.signature = signature2;

            const requests = [request1, request2];

            await expect(
                forwarder.connect(relayer).executeBatch(requests, relayer.address)
            ).to.emit(forwarder, "ExecutedForwardRequest");

            const storedMessage1 = await receiver.message();
            expect(storedMessage1).to.equal(message1);

            // Check the second message
            const storedMessage2 = await receiver.message();
            expect(storedMessage2).to.equal(message2);
        });
    });
});
