// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../../contracts/Diamond.sol";
import "../../contracts/facets/DiamondCutFacet.sol";
import "../../contracts/facets/DiamondLoupeFacet.sol";
import "../../contracts/facets/OwnershipFacet.sol";
import "../../contracts/facets/Test1Facet.sol";
import "../../contracts/interfaces/IDiamond.sol";

contract CacheBugTest is Test {
    Diamond diamond;
    DiamondCutFacet diamondCutFacet;
    DiamondLoupeFacet diamondLoupeFacet;
    Test1Facet test1Facet;
    address test1FacetAddress;
    
    // Selectors for testing cache bug
    bytes4 constant ownerSel = 0x8da5cb5b;
    bytes4 constant sel0 = 0x19e3b533; // fills up slot 1
    bytes4 constant sel1 = 0x0716c2ae; // fills up slot 1
    bytes4 constant sel2 = 0x11046047; // fills up slot 1
    bytes4 constant sel3 = 0xcf3bbe18; // fills up slot 1
    bytes4 constant sel4 = 0x24c1d5a7; // fills up slot 1
    bytes4 constant sel5 = 0xcbb835f6; // fills up slot 1
    bytes4 constant sel6 = 0xcbb835f7; // fills up slot 1
    bytes4 constant sel7 = 0xcbb835f8; // fills up slot 2
    bytes4 constant sel8 = 0xcbb835f9; // fills up slot 2
    bytes4 constant sel9 = 0xcbb835fa; // fills up slot 2
    bytes4 constant sel10 = 0xcbb835fb; // fills up slot 2

    function setUp() public {
        // 1. 각 facet 배포
        DiamondCutFacet cutFacet = new DiamondCutFacet();
        DiamondLoupeFacet loupeFacet = new DiamondLoupeFacet();
        OwnershipFacet ownerFacet = new OwnershipFacet();

        // 2. 각 facet의 selector 수동 배열
        bytes4[] memory cutFacetSelectors = new bytes4[](1);
        cutFacetSelectors[0] = DiamondCutFacet.diamondCut.selector;

        bytes4[] memory loupeFacetSelectors = new bytes4[](4);
        loupeFacetSelectors[0] = DiamondLoupeFacet.facetFunctionSelectors.selector;
        loupeFacetSelectors[1] = DiamondLoupeFacet.facetAddresses.selector;
        loupeFacetSelectors[2] = DiamondLoupeFacet.facetAddress.selector;
        loupeFacetSelectors[3] = DiamondLoupeFacet.facets.selector;

        bytes4[] memory ownerFacetSelectors = new bytes4[](2);
        ownerFacetSelectors[0] = OwnershipFacet.owner.selector;
        ownerFacetSelectors[1] = OwnershipFacet.transferOwnership.selector;

        // 3. FacetCut 배열 준비 (생성자에서 사용)
        IDiamond.FacetCut[] memory diamondCut = new IDiamond.FacetCut[](3);
        diamondCut[0] = IDiamond.FacetCut({
            facetAddress: address(cutFacet),
            action: IDiamond.FacetCutAction.Add,
            functionSelectors: cutFacetSelectors
        });
        diamondCut[1] = IDiamond.FacetCut({
            facetAddress: address(loupeFacet),
            action: IDiamond.FacetCutAction.Add,
            functionSelectors: loupeFacetSelectors
        });
        diamondCut[2] = IDiamond.FacetCut({
            facetAddress: address(ownerFacet),
            action: IDiamond.FacetCutAction.Add,
            functionSelectors: ownerFacetSelectors
        });

        // 4. DiamondArgs 준비
        DiamondArgs memory args = DiamondArgs({
            owner: address(this),
            init: address(0),
            initCalldata: ""
        });

        // 5. Diamond 배포 (생성자에서 바로 facet 등록)
        diamond = new Diamond(diamondCut, args);
        diamondCutFacet = DiamondCutFacet(address(diamond));
        diamondLoupeFacet = DiamondLoupeFacet(address(diamond));
        
        // Deploy test1Facet
        test1Facet = new Test1Facet();
        test1FacetAddress = address(test1Facet);

        // Add functions to diamond
        bytes4[] memory selectors = new bytes4[](11);
        selectors[0] = sel0;
        selectors[1] = sel1;
        selectors[2] = sel2;
        selectors[3] = sel3;
        selectors[4] = sel4;
        selectors[5] = sel5;
        selectors[6] = sel6;
        selectors[7] = sel7;
        selectors[8] = sel8;
        selectors[9] = sel9;
        selectors[10] = sel10;

        IDiamond.FacetCut[] memory cut = new IDiamond.FacetCut[](1);
        cut[0] = IDiamond.FacetCut({
            facetAddress: test1FacetAddress,
            action: IDiamond.FacetCutAction.Add,
            functionSelectors: selectors
        });

        diamondCutFacet.diamondCut(cut, address(0), "");

        // Remove function selectors (including ownerSel which is not in the facet)
        bytes4[] memory selectorsToRemove = new bytes4[](3);
        selectorsToRemove[0] = ownerSel; // owner selector (not in facet)
        selectorsToRemove[1] = sel5;
        selectorsToRemove[2] = sel10;

        cut[0] = IDiamond.FacetCut({
            facetAddress: address(0),
            action: IDiamond.FacetCutAction.Remove,
            functionSelectors: selectorsToRemove
        });

        diamondCutFacet.diamondCut(cut, address(0), "");
    }

    function testShouldNotExhibitTheCacheBug() public {
        // Get the test1Facet's registered functions
        bytes4[] memory selectors = diamondLoupeFacet.facetFunctionSelectors(test1FacetAddress);

        // Check individual correctness
        assertTrue(containsSelector(selectors, sel0), "Does not contain sel0");
        assertTrue(containsSelector(selectors, sel1), "Does not contain sel1");
        assertTrue(containsSelector(selectors, sel2), "Does not contain sel2");
        assertTrue(containsSelector(selectors, sel3), "Does not contain sel3");
        assertTrue(containsSelector(selectors, sel4), "Does not contain sel4");
        assertTrue(containsSelector(selectors, sel6), "Does not contain sel6");
        assertTrue(containsSelector(selectors, sel7), "Does not contain sel7");
        assertTrue(containsSelector(selectors, sel8), "Does not contain sel8");
        assertTrue(containsSelector(selectors, sel9), "Does not contain sel9");

        assertFalse(containsSelector(selectors, ownerSel), "Contains ownerSel");
        assertFalse(containsSelector(selectors, sel10), "Contains sel10");
        assertFalse(containsSelector(selectors, sel5), "Contains sel5");
    }

    function containsSelector(bytes4[] memory selectors, bytes4 selector) internal pure returns (bool) {
        for (uint256 i = 0; i < selectors.length; i++) {
            if (selectors[i] == selector) {
                return true;
            }
        }
        return false;
    }
} 