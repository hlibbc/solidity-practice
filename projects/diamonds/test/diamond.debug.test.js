/* global describe it before ethers */
const { ethers } = require("hardhat");

const {
    getSelectors,
    FacetCutAction,
    removeSelectors,
    findAddressPositionInFacets
} = require('../scripts/libraries/diamond.js')
const { deployDiamond } = require('../scripts/deploy.js')
const { assert } = require('chai')

describe('DiamondTest', async function () {
    let diamondAddress
    let diamondCutFacet
    let diamondLoupeFacet
    let ownershipFacet
    let tx
    let receipt
    let result
    const addresses = []

    before(async function () {
        diamondAddress = await deployDiamond()
        diamondCutFacet = await ethers.getContractAt('DiamondCutFacet', diamondAddress)
        diamondLoupeFacet = await ethers.getContractAt('DiamondLoupeFacet', diamondAddress)
        ownershipFacet = await ethers.getContractAt('OwnershipFacet', diamondAddress)
    })

    it('should have three facets -- call to facetAddresses function', async () => {
        for (const address of await diamondLoupeFacet.facetAddresses()) {
            addresses.push(address)
        }
        assert.equal(addresses.length, 3)
    })

    it('facets should have the right function selectors -- call to facetFunctionSelectors function', async () => {
        let selectors = getSelectors(diamondCutFacet)
        result = await diamondLoupeFacet.facetFunctionSelectors(addresses[0])
        assert.sameMembers([...result], [...selectors])

        selectors = getSelectors(diamondLoupeFacet)
        result = await diamondLoupeFacet.facetFunctionSelectors(addresses[1])
        assert.sameMembers([...result], [...selectors])

        selectors = getSelectors(ownershipFacet)
        result = await diamondLoupeFacet.facetFunctionSelectors(addresses[2])
        assert.sameMembers([...result], [...selectors])
    })

    it('selectors should be associated to facets correctly -- multiple calls to facetAddress function', async () => {
        assert.equal(
            addresses[0],
            await diamondLoupeFacet.facetAddress('0x1f931c1c')
        )
        assert.equal(
            addresses[1],
            await diamondLoupeFacet.facetAddress('0xcdffacc6')
        )
        assert.equal(
            addresses[1],
            await diamondLoupeFacet.facetAddress('0x01ffc9a7')
        )
        assert.equal(
            addresses[2],
            await diamondLoupeFacet.facetAddress('0xf2fde38b')
        )
    })

    it('should add test1 functions', async () => {
        const Test1Facet = await ethers.getContractFactory('Test1Facet')
        const test1Facet = await Test1Facet.deploy()
        await test1Facet.waitForDeployment()
        let test1FacetAddress = await test1Facet.getAddress()
        addresses.push(test1FacetAddress)

        const selectors = getSelectors(test1Facet).remove(['supportsInterface(bytes4)'])

        // ethers v6 requires tuple args for struct, not named object
        tx = await diamondCutFacet.diamondCut(
            [
                [
                    test1FacetAddress,
                    FacetCutAction.Add,
                    selectors
                ]
            ],
            ethers.ZeroAddress,
            '0x',
            { gasLimit: 800_000 }
        )
        receipt = await tx.wait()
        if (!receipt.status) {
            throw Error(`Diamond upgrade failed: ${tx.hash}`)
        }
        result = await diamondLoupeFacet.facetFunctionSelectors(test1FacetAddress)
        assert.sameMembers([...result], [...selectors])
    })

    it('should test function call', async () => {
        const test1Facet = await ethers.getContractAt('Test1Facet', diamondAddress)
        await test1Facet.test1Func10()
    })

    it('should replace supportsInterface function', async () => {
        const Test1Facet = await ethers.getContractFactory('Test1Facet')
        const selectors = getSelectors(Test1Facet).get(['supportsInterface(bytes4)'])
        const testFacetAddress = addresses[3]

        tx = await diamondCutFacet.diamondCut(
            [
                [
                    testFacetAddress,
                    FacetCutAction.Replace,
                    selectors
                ]
            ],
            ethers.ZeroAddress,
            '0x',
            { gasLimit: 800_000 }
        )
        receipt = await tx.wait()
        if (!receipt.status) {
            throw Error(`Diamond upgrade failed: ${tx.hash}`)
        }
        result = await diamondLoupeFacet.facetFunctionSelectors(testFacetAddress)
        assert.sameMembers([...result], [...getSelectors(Test1Facet)])
    })

    it('should add test2 functions', async () => {
        const Test2Facet = await ethers.getContractFactory('Test2Facet')
        const test2Facet = await Test2Facet.deploy()
        await test2Facet.waitForDeployment()
        let test2FacetAddress = await test2Facet.getAddress()
        addresses.push(test2FacetAddress)

        const selectors = getSelectors(test2Facet)
        tx = await diamondCutFacet.diamondCut(
            [
                [
                    test2FacetAddress,
                    FacetCutAction.Add,
                    selectors
                ]
            ],
            ethers.ZeroAddress,
            '0x',
            { gasLimit: 800_000 }
        )
        receipt = await tx.wait()
        if (!receipt.status) {
            throw Error(`Diamond upgrade failed: ${tx.hash}`)
        }
        result = await diamondLoupeFacet.facetFunctionSelectors(test2FacetAddress)
        assert.sameMembers([...result], [...selectors])
    })

    it('should remove some test2 functions', async () => {
        const test2Facet = await ethers.getContractAt('Test2Facet', diamondAddress)
        const functionsToKeep = ['test2Func1()', 'test2Func5()', 'test2Func6()', 'test2Func19()', 'test2Func20()']
        const selectors = getSelectors(test2Facet).remove(functionsToKeep)

        tx = await diamondCutFacet.diamondCut(
            [
                [
                    ethers.ZeroAddress,
                    FacetCutAction.Remove,
                    selectors
                ]
            ],
            ethers.ZeroAddress,
            '0x',
            { gasLimit: 800_000 }
        )
        receipt = await tx.wait()
        if (!receipt.status) {
            throw Error(`Diamond upgrade failed: ${tx.hash}`)
        }
        result = await diamondLoupeFacet.facetFunctionSelectors(addresses[4])
        assert.sameMembers([...result], [...getSelectors(test2Facet).get(functionsToKeep)])
    })

    it('should remove some test1 functions', async () => {
        const test1Facet = await ethers.getContractAt('Test1Facet', diamondAddress)
        const functionsToKeep = ['test1Func2()', 'test1Func11()', 'test1Func12()']
        const selectors = getSelectors(test1Facet).remove(functionsToKeep)

        tx = await diamondCutFacet.diamondCut(
            [
                [
                    ethers.ZeroAddress,
                    FacetCutAction.Remove,
                    selectors
                ]
            ],
            ethers.ZeroAddress,
            '0x',
            { gasLimit: 800_000 }
        )
        receipt = await tx.wait()
        if (!receipt.status) {
            throw Error(`Diamond upgrade failed: ${tx.hash}`)
        }
        result = await diamondLoupeFacet.facetFunctionSelectors(addresses[3])
        assert.sameMembers([...result], [...getSelectors(test1Facet).get(functionsToKeep)])
    })

    it('remove all functions and facets accept \'diamondCut\' and \'facets\'', async () => {
        let selectors = []
        let facets = await diamondLoupeFacet.facets()
        for (let i = 0; i < facets.length; i++) {
            selectors.push(...facets[i].functionSelectors)
        }
        selectors = removeSelectors(selectors, ['facets()', 'diamondCut(tuple(address,uint8,bytes4[])[],address,bytes)'])

        tx = await diamondCutFacet.diamondCut(
            [
                [
                    ethers.ZeroAddress,
                    FacetCutAction.Remove,
                    selectors
                ]
            ],
            ethers.ZeroAddress,
            '0x',
            { gasLimit: 8_000_000 }
        )
        receipt = await tx.wait()
        if (!receipt.status) {
            throw Error(`Diamond upgrade failed: ${tx.hash}`)
        }
        facets = await diamondLoupeFacet.facets()
        assert.equal(facets.length, 2)
        assert.equal(facets[0][0], addresses[0])
        assert.sameMembers([...facets[0][1]], ['0x1f931c1c'])
        assert.equal(facets[1][0], addresses[1])
        assert.sameMembers([...facets[1][1]], ['0x7a0ed627'])
    })

    /// 다수의 Facet과 그에 속한 함수 셀렉터들을 한꺼번에 Diamond에 추가한 뒤, 모든 Facet/Selector 상태가 정확히 반영되었는지 검증
    it('add most functions and facets', async () => {
        const diamondLoupeFacetSelectors = getSelectors(diamondLoupeFacet).remove(['supportsInterface(bytes4)'])
        const Test1Facet = await ethers.getContractFactory('Test1Facet')
        const Test2Facet = await ethers.getContractFactory('Test2Facet')
        const cut = [
            [
                addresses[1],
                FacetCutAction.Add,
                diamondLoupeFacetSelectors.remove(['facets()'])
            ],
            [
                addresses[2],
                FacetCutAction.Add,
                getSelectors(ownershipFacet)
            ],
            [
                addresses[3],
                FacetCutAction.Add,
                getSelectors(Test1Facet)
            ],
            [
                addresses[4],
                FacetCutAction.Add,
                getSelectors(Test2Facet)
            ]
        ]

        tx = await diamondCutFacet.diamondCut(cut, ethers.ZeroAddress, '0x', { gasLimit: 8_000_000 })
        receipt = await tx.wait()
        if (!receipt.status) {
            throw Error(`Diamond upgrade failed: ${tx.hash}`)
        }
        const facets = await diamondLoupeFacet.facets()
        const facetAddresses = await diamondLoupeFacet.facetAddresses()
        assert.equal(facetAddresses.length, 5)
        assert.equal(facets.length, 5)
        assert.sameMembers([...facetAddresses], [...addresses])
        assert.equal(facets[0][0], facetAddresses[0], 'first facet')
        assert.equal(facets[1][0], facetAddresses[1], 'second facet')
        assert.equal(facets[2][0], facetAddresses[2], 'third facet')
        assert.equal(facets[3][0], facetAddresses[3], 'fourth facet')
        assert.equal(facets[4][0], facetAddresses[4], 'fifth facet')
        assert.sameMembers([...facets[findAddressPositionInFacets(addresses[0], facets)][1]], [...getSelectors(diamondCutFacet)])
        assert.sameMembers([...facets[findAddressPositionInFacets(addresses[1], facets)][1]], [...diamondLoupeFacetSelectors])
        assert.sameMembers([...facets[findAddressPositionInFacets(addresses[2], facets)][1]], [...getSelectors(ownershipFacet)])
        assert.sameMembers([...facets[findAddressPositionInFacets(addresses[3], facets)][1]], [...getSelectors(Test1Facet)])
        assert.sameMembers([...facets[findAddressPositionInFacets(addresses[4], facets)][1]], [...getSelectors(Test2Facet)])
    })
})