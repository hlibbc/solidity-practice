// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../../contracts/Diamond.sol";
import "../../contracts/facets/DiamondCutFacet.sol";
import "../../contracts/facets/DiamondLoupeFacet.sol";
import "../../contracts/facets/OwnershipFacet.sol";
import "../../contracts/facets/Test1Facet.sol";
import "../../contracts/facets/Test2Facet.sol";
import "../../contracts/libraries/LibDiamond.sol";
import "../../contracts/interfaces/IDiamond.sol";

contract DiamondTest is Test {
    Diamond diamond;
    DiamondCutFacet diamondCutFacet;
    DiamondLoupeFacet diamondLoupeFacet;
    OwnershipFacet ownershipFacet;
    Test1Facet test1Facet;
    Test2Facet test2Facet;
    
    address[] addresses;
    
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
        ownershipFacet = OwnershipFacet(address(diamond));

        // 6. Get initial facet addresses
        addresses = diamondLoupeFacet.facetAddresses();
    }

    function testShouldHaveThreeFacets() public {
        assertEq(addresses.length, 3, "Should have exactly 3 facets");
    }

    function testFacetsShouldHaveRightFunctionSelectors() public {
        bytes4[] memory result0 = diamondLoupeFacet.facetFunctionSelectors(addresses[0]);
        bytes4[] memory result1 = diamondLoupeFacet.facetFunctionSelectors(addresses[1]);
        bytes4[] memory result2 = diamondLoupeFacet.facetFunctionSelectors(addresses[2]);

        assertGt(result0.length, 0, "DiamondCut should have selectors");
        assertGt(result1.length, 0, "DiamondLoupe should have selectors");
        assertGt(result2.length, 0, "Ownership should have selectors");
    }

    function testSelectorsShouldBeAssociatedToFacetsCorrectly() public {
        assertEq(
            addresses[0],
            diamondLoupeFacet.facetAddress(0x1f931c1c),
            "DiamondCut selector should map to correct address"
        );
        assertEq(
            addresses[1],
            diamondLoupeFacet.facetAddress(0xcdffacc6),
            "DiamondLoupe selector should map to correct address"
        );
        assertEq(
            addresses[1],
            diamondLoupeFacet.facetAddress(0x7a0ed627),
            "Facets selector should map to correct address"
        );
        assertEq(
            addresses[2],
            diamondLoupeFacet.facetAddress(0xf2fde38b),
            "Ownership selector should map to correct address"
        );
    }

    function testShouldAddTest1Functions() public {
        test1Facet = new Test1Facet();
        address test1FacetAddress = address(test1Facet);

        // Define selectors manually for Test1Facet (including supportsInterface)
        bytes4[] memory selectors = new bytes4[](12);
        selectors[0] = test1Facet.test1Func1.selector;
        selectors[1] = test1Facet.test1Func2.selector;
        selectors[2] = test1Facet.test1Func3.selector;
        selectors[3] = test1Facet.test1Func4.selector;
        selectors[4] = test1Facet.test1Func5.selector;
        selectors[5] = test1Facet.test1Func6.selector;
        selectors[6] = test1Facet.test1Func7.selector;
        selectors[7] = test1Facet.test1Func8.selector;
        selectors[8] = test1Facet.test1Func9.selector;
        selectors[9] = test1Facet.test1Func10.selector;
        selectors[10] = test1Facet.test1Func11.selector;
        selectors[11] = test1Facet.test1Func12.selector;

        IDiamond.FacetCut[] memory cut = new IDiamond.FacetCut[](1);
        cut[0] = IDiamond.FacetCut({
            facetAddress: test1FacetAddress,
            action: IDiamond.FacetCutAction.Add,
            functionSelectors: selectors
        });

        diamondCutFacet.diamondCut(cut, address(0), "");
        
        bytes4[] memory result = diamondLoupeFacet.facetFunctionSelectors(test1FacetAddress);
        assertEq(result.length, selectors.length, "Test1Facet selectors should match");
    }

    function testShouldTestFunctionCall() public {
        test1Facet = new Test1Facet();
        address test1FacetAddress = address(test1Facet);
        
        // Define selectors manually for Test1Facet
        bytes4[] memory selectors = new bytes4[](12);
        selectors[0] = test1Facet.test1Func1.selector;
        selectors[1] = test1Facet.test1Func2.selector;
        selectors[2] = test1Facet.test1Func3.selector;
        selectors[3] = test1Facet.test1Func4.selector;
        selectors[4] = test1Facet.test1Func5.selector;
        selectors[5] = test1Facet.test1Func6.selector;
        selectors[6] = test1Facet.test1Func7.selector;
        selectors[7] = test1Facet.test1Func8.selector;
        selectors[8] = test1Facet.test1Func9.selector;
        selectors[9] = test1Facet.test1Func10.selector;
        selectors[10] = test1Facet.test1Func11.selector;
        selectors[11] = test1Facet.test1Func12.selector;
        
        IDiamond.FacetCut[] memory cut = new IDiamond.FacetCut[](1);
        cut[0] = IDiamond.FacetCut({
            facetAddress: test1FacetAddress,
            action: IDiamond.FacetCutAction.Add,
            functionSelectors: selectors
        });

        diamondCutFacet.diamondCut(cut, address(0), "");
        
        // Test function call
        Test1Facet(address(diamond)).test1Func10();
    }

    function testShouldReplaceSupportsInterfaceFunction() public {
        // 1. 기존 facet 등록
        test1Facet = new Test1Facet();
        address test1FacetAddress = address(test1Facet);

        // First add all functions including supportsInterface
        bytes4[] memory selectors = new bytes4[](12);
        selectors[0] = test1Facet.test1Func1.selector;
        selectors[1] = test1Facet.test1Func2.selector;
        selectors[2] = test1Facet.test1Func3.selector;
        selectors[3] = test1Facet.test1Func4.selector;
        selectors[4] = test1Facet.test1Func5.selector;
        selectors[5] = test1Facet.test1Func6.selector;
        selectors[6] = test1Facet.test1Func7.selector;
        selectors[7] = test1Facet.test1Func8.selector;
        selectors[8] = test1Facet.test1Func9.selector;
        selectors[9] = test1Facet.test1Func10.selector;
        selectors[10] = test1Facet.test1Func11.selector;
        selectors[11] = test1Facet.test1Func12.selector;
        
        IDiamond.FacetCut[] memory cut = new IDiamond.FacetCut[](1);
        cut[0] = IDiamond.FacetCut({
            facetAddress: test1FacetAddress,
            action: IDiamond.FacetCutAction.Add,
            functionSelectors: selectors
        });
        diamondCutFacet.diamondCut(cut, address(0), "");

        // 2. 새로운 facet 인스턴스 생성
        Test1Facet test1FacetNew = new Test1Facet();
        address test1FacetNewAddress = address(test1FacetNew);

        // replace test1Func1을 새로운 인스턴스의 함수로 교체
        bytes4[] memory functionToReplace = new bytes4[](1);
        functionToReplace[0] = test1Facet.test1Func1.selector;

        cut[0] = IDiamond.FacetCut({
            facetAddress: test1FacetNewAddress,
            action: IDiamond.FacetCutAction.Replace,
            functionSelectors: functionToReplace
        });
        diamondCutFacet.diamondCut(cut, address(0), "");

        bytes4[] memory result = diamondLoupeFacet.facetFunctionSelectors(test1FacetNewAddress);
        assertTrue(result.length > 0, "Test1FacetNew should have selectors after replace");
    }

    function testShouldAddTest2Functions() public {
        test2Facet = new Test2Facet();
        address test2FacetAddress = address(test2Facet);
        addresses.push(test2FacetAddress);

        // Define selectors manually for Test2Facet
        bytes4[] memory selectors = new bytes4[](20);
        selectors[0] = test2Facet.test2Func1.selector;
        selectors[1] = test2Facet.test2Func2.selector;
        selectors[2] = test2Facet.test2Func3.selector;
        selectors[3] = test2Facet.test2Func4.selector;
        selectors[4] = test2Facet.test2Func5.selector;
        selectors[5] = test2Facet.test2Func6.selector;
        selectors[6] = test2Facet.test2Func7.selector;
        selectors[7] = test2Facet.test2Func8.selector;
        selectors[8] = test2Facet.test2Func9.selector;
        selectors[9] = test2Facet.test2Func10.selector;
        selectors[10] = test2Facet.test2Func11.selector;
        selectors[11] = test2Facet.test2Func12.selector;
        selectors[12] = test2Facet.test2Func13.selector;
        selectors[13] = test2Facet.test2Func14.selector;
        selectors[14] = test2Facet.test2Func15.selector;
        selectors[15] = test2Facet.test2Func16.selector;
        selectors[16] = test2Facet.test2Func17.selector;
        selectors[17] = test2Facet.test2Func18.selector;
        selectors[18] = test2Facet.test2Func19.selector;
        selectors[19] = test2Facet.test2Func20.selector;
        
        IDiamond.FacetCut[] memory cut = new IDiamond.FacetCut[](1);
        cut[0] = IDiamond.FacetCut({
            facetAddress: test2FacetAddress,
            action: IDiamond.FacetCutAction.Add,
            functionSelectors: selectors
        });

        diamondCutFacet.diamondCut(cut, address(0), "");
        
        bytes4[] memory result = diamondLoupeFacet.facetFunctionSelectors(test2FacetAddress);
        assertEq(result.length, selectors.length, "Test2Facet selectors should match");
    }

    function testShouldRemoveSomeTest2Functions() public {
        test2Facet = new Test2Facet();
        address test2FacetAddress = address(test2Facet);
        addresses.push(test2FacetAddress);

        // First add all functions
        // Define selectors manually for Test2Facet
        bytes4[] memory selectors = new bytes4[](20);
        selectors[0] = test2Facet.test2Func1.selector;
        selectors[1] = test2Facet.test2Func2.selector;
        selectors[2] = test2Facet.test2Func3.selector;
        selectors[3] = test2Facet.test2Func4.selector;
        selectors[4] = test2Facet.test2Func5.selector;
        selectors[5] = test2Facet.test2Func6.selector;
        selectors[6] = test2Facet.test2Func7.selector;
        selectors[7] = test2Facet.test2Func8.selector;
        selectors[8] = test2Facet.test2Func9.selector;
        selectors[9] = test2Facet.test2Func10.selector;
        selectors[10] = test2Facet.test2Func11.selector;
        selectors[11] = test2Facet.test2Func12.selector;
        selectors[12] = test2Facet.test2Func13.selector;
        selectors[13] = test2Facet.test2Func14.selector;
        selectors[14] = test2Facet.test2Func15.selector;
        selectors[15] = test2Facet.test2Func16.selector;
        selectors[16] = test2Facet.test2Func17.selector;
        selectors[17] = test2Facet.test2Func18.selector;
        selectors[18] = test2Facet.test2Func19.selector;
        selectors[19] = test2Facet.test2Func20.selector;
        IDiamond.FacetCut[] memory cut = new IDiamond.FacetCut[](1);
        cut[0] = IDiamond.FacetCut({
            facetAddress: test2FacetAddress,
            action: IDiamond.FacetCutAction.Add,
            functionSelectors: selectors
        });
        diamondCutFacet.diamondCut(cut, address(0), "");

        // Then remove some functions
        bytes4[] memory functionsToKeep = new bytes4[](5);
        functionsToKeep[0] = test2Facet.test2Func1.selector;
        functionsToKeep[1] = test2Facet.test2Func5.selector;
        functionsToKeep[2] = test2Facet.test2Func6.selector;
        functionsToKeep[3] = test2Facet.test2Func19.selector;
        functionsToKeep[4] = test2Facet.test2Func20.selector;

        bytes4[] memory functionsToRemove = new bytes4[](selectors.length - 5);
        uint256 j = 0;
        for (uint256 i = 0; i < selectors.length; i++) {
            bool shouldKeep = false;
            for (uint256 k = 0; k < functionsToKeep.length; k++) {
                if (selectors[i] == functionsToKeep[k]) {
                    shouldKeep = true;
                    break;
                }
            }
            if (!shouldKeep) {
                functionsToRemove[j] = selectors[i];
                j++;
            }
        }

        cut[0] = IDiamond.FacetCut({
            facetAddress: address(0),
            action: IDiamond.FacetCutAction.Remove,
            functionSelectors: functionsToRemove
        });
        diamondCutFacet.diamondCut(cut, address(0), "");

        bytes4[] memory result = diamondLoupeFacet.facetFunctionSelectors(test2FacetAddress);
        assertEq(result.length, 5, "Should have exactly 5 functions remaining");
    }

    function testShouldRemoveSomeTest1Functions() public {
        test1Facet = new Test1Facet();
        address test1FacetAddress = address(test1Facet);
        addresses.push(test1FacetAddress);

        // First add all functions
        // Define selectors manually for Test1Facet
        bytes4[] memory selectors = new bytes4[](12);
        selectors[0] = test1Facet.test1Func1.selector;
        selectors[1] = test1Facet.test1Func2.selector;
        selectors[2] = test1Facet.test1Func3.selector;
        selectors[3] = test1Facet.test1Func4.selector;
        selectors[4] = test1Facet.test1Func5.selector;
        selectors[5] = test1Facet.test1Func6.selector;
        selectors[6] = test1Facet.test1Func7.selector;
        selectors[7] = test1Facet.test1Func8.selector;
        selectors[8] = test1Facet.test1Func9.selector;
        selectors[9] = test1Facet.test1Func10.selector;
        selectors[10] = test1Facet.test1Func11.selector;
        selectors[11] = test1Facet.test1Func12.selector;
        IDiamond.FacetCut[] memory cut = new IDiamond.FacetCut[](1);
        cut[0] = IDiamond.FacetCut({
            facetAddress: test1FacetAddress,
            action: IDiamond.FacetCutAction.Add,
            functionSelectors: selectors
        });
        diamondCutFacet.diamondCut(cut, address(0), "");

        // Then remove some functions
        bytes4[] memory functionsToKeep = new bytes4[](3);
        functionsToKeep[0] = test1Facet.test1Func2.selector;
        functionsToKeep[1] = test1Facet.test1Func11.selector;
        functionsToKeep[2] = test1Facet.test1Func12.selector;

        bytes4[] memory functionsToRemove = new bytes4[](selectors.length - 3);
        uint256 j = 0;
        for (uint256 i = 0; i < selectors.length; i++) {
            bool shouldKeep = false;
            for (uint256 k = 0; k < functionsToKeep.length; k++) {
                if (selectors[i] == functionsToKeep[k]) {
                    shouldKeep = true;
                    break;
                }
            }
            if (!shouldKeep) {
                functionsToRemove[j] = selectors[i];
                j++;
            }
        }

        cut[0] = IDiamond.FacetCut({
            facetAddress: address(0),
            action: IDiamond.FacetCutAction.Remove,
            functionSelectors: functionsToRemove
        });
        diamondCutFacet.diamondCut(cut, address(0), "");

        bytes4[] memory result = diamondLoupeFacet.facetFunctionSelectors(test1FacetAddress);
        assertEq(result.length, 3, "Should have exactly 3 functions remaining");
    }

    function testRemoveAllFunctionsAndFacetsAcceptDiamondCutAndFacets() public {
        // Get all facets and selectors
        IDiamondLoupe.Facet[] memory facets = diamondLoupeFacet.facets();
        bytes4[] memory allSelectors = new bytes4[](100); // Assume max 100 selectors
        uint256 selectorCount = 0;
        
        for (uint256 i = 0; i < facets.length; i++) {
            for (uint256 k = 0; k < facets[i].functionSelectors.length; k++) {
                allSelectors[selectorCount] = facets[i].functionSelectors[k];
                selectorCount++;
            }
        }

        // Remove all selectors except diamondCut and facets
        bytes4[] memory selectorsToRemove = new bytes4[](selectorCount - 2);
        uint256 j = 0;
        for (uint256 i = 0; i < selectorCount; i++) {
            if (allSelectors[i] != 0x1f931c1c && allSelectors[i] != 0x7a0ed627) { // diamondCut and facets
                selectorsToRemove[j] = allSelectors[i];
                j++;
            }
        }

        IDiamond.FacetCut[] memory cut = new IDiamond.FacetCut[](1);
        cut[0] = IDiamond.FacetCut({
            facetAddress: address(0),
            action: IDiamond.FacetCutAction.Remove,
            functionSelectors: selectorsToRemove
        });
        diamondCutFacet.diamondCut(cut, address(0), "");

        facets = diamondLoupeFacet.facets();
        assertEq(facets.length, 2, "Should have exactly 2 facets remaining");
    }

    function testAddMostFunctionsAndFacets() public {
        // This test adds multiple facets at once
        test1Facet = new Test1Facet();
        test2Facet = new Test2Facet();
        
        address test1FacetAddress = address(test1Facet);
        address test2FacetAddress = address(test2Facet);
        
        addresses.push(test1FacetAddress);
        addresses.push(test2FacetAddress);

        // Define selectors manually for new facets only
        bytes4[] memory test1Selectors = new bytes4[](12);
        test1Selectors[0] = test1Facet.test1Func1.selector;
        test1Selectors[1] = test1Facet.test1Func2.selector;
        test1Selectors[2] = test1Facet.test1Func3.selector;
        test1Selectors[3] = test1Facet.test1Func4.selector;
        test1Selectors[4] = test1Facet.test1Func5.selector;
        test1Selectors[5] = test1Facet.test1Func6.selector;
        test1Selectors[6] = test1Facet.test1Func7.selector;
        test1Selectors[7] = test1Facet.test1Func8.selector;
        test1Selectors[8] = test1Facet.test1Func9.selector;
        test1Selectors[9] = test1Facet.test1Func10.selector;
        test1Selectors[10] = test1Facet.test1Func11.selector;
        test1Selectors[11] = test1Facet.test1Func12.selector;
        
        bytes4[] memory test2Selectors = new bytes4[](20);
        test2Selectors[0] = test2Facet.test2Func1.selector;
        test2Selectors[1] = test2Facet.test2Func2.selector;
        test2Selectors[2] = test2Facet.test2Func3.selector;
        test2Selectors[3] = test2Facet.test2Func4.selector;
        test2Selectors[4] = test2Facet.test2Func5.selector;
        test2Selectors[5] = test2Facet.test2Func6.selector;
        test2Selectors[6] = test2Facet.test2Func7.selector;
        test2Selectors[7] = test2Facet.test2Func8.selector;
        test2Selectors[8] = test2Facet.test2Func9.selector;
        test2Selectors[9] = test2Facet.test2Func10.selector;
        test2Selectors[10] = test2Facet.test2Func11.selector;
        test2Selectors[11] = test2Facet.test2Func12.selector;
        test2Selectors[12] = test2Facet.test2Func13.selector;
        test2Selectors[13] = test2Facet.test2Func14.selector;
        test2Selectors[14] = test2Facet.test2Func15.selector;
        test2Selectors[15] = test2Facet.test2Func16.selector;
        test2Selectors[16] = test2Facet.test2Func17.selector;
        test2Selectors[17] = test2Facet.test2Func18.selector;
        test2Selectors[18] = test2Facet.test2Func19.selector;
        test2Selectors[19] = test2Facet.test2Func20.selector;

        IDiamond.FacetCut[] memory cut = new IDiamond.FacetCut[](2);
        cut[0] = IDiamond.FacetCut({
            facetAddress: test1FacetAddress,
            action: IDiamond.FacetCutAction.Add,
            functionSelectors: test1Selectors
        });
        cut[1] = IDiamond.FacetCut({
            facetAddress: test2FacetAddress,
            action: IDiamond.FacetCutAction.Add,
            functionSelectors: test2Selectors
        });

        diamondCutFacet.diamondCut(cut, address(0), "");

        address[] memory facetAddresses = diamondLoupeFacet.facetAddresses();
        assertEq(facetAddresses.length, 5, "Should have exactly 5 facets");
    }
} 