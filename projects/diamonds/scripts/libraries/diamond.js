const { ethers } = require("hardhat");

const FacetCutAction = { Add: 0, Replace: 1, Remove: 2 };

// get function selectors from ABI
function getSelectors(contract) {
    const selectors = contract.interface.fragments
        .filter((f) => f.type === "function" && f.name !== "init")
        .map((f) => contract.interface.getFunction(f.name).selector);

    selectors.contract = contract;
    selectors.remove = remove;
    selectors.get = get;
    return selectors;
}

// get function selector from full signature string, e.g., 'function balanceOf(address)'
function getSelector(signature) {
    const iface = new ethers.Interface([signature]);
    const func = iface.getFunction(signature.match(/function (.+)/)[1]);
    return func.selector;
}

// used with getSelectors to remove selectors from an array of selectors
function remove(functionNames) {
    const selectors = this.filter((selector) => {
        for (const functionName of functionNames) {
            const funcSelector = this.contract.interface.getFunction(functionName).selector;
            if (selector === funcSelector) {
                return false;
            }
        }
        return true;
    });
    selectors.contract = this.contract;
    selectors.remove = this.remove;
    selectors.get = this.get;
    return selectors;
}

// used with getSelectors to get selectors from an array of selectors
function get(functionNames) {
    const selectors = this.filter((selector) => {
        for (const functionName of functionNames) {
            const funcSelector = this.contract.interface.getFunction(functionName).selector;
            if (selector === funcSelector) {
                return true;
            }
        }
        return false;
    });
    selectors.contract = this.contract;
    selectors.remove = this.remove;
    selectors.get = this.get;
    return selectors;
}

// remove selectors using an array of full function signatures
function removeSelectors(selectors, signatures) {
    const iface = new ethers.Interface(signatures.map((sig) => `function ${sig}`));
    const toRemove = signatures.map((sig) => iface.getFunction(sig).selector);
    return selectors.filter((selector) => !toRemove.includes(selector));
}

// find a particular address position in the return value of diamondLoupeFacet.facets()
function findAddressPositionInFacets(facetAddress, facets) {
    for (let i = 0; i < facets.length; i++) {
        if (facets[i].facetAddress === facetAddress) {
            return i;
        }
    }
    return -1;
}

module.exports = {
    getSelectors,
    getSelector,
    FacetCutAction,
    remove,
    removeSelectors,
    findAddressPositionInFacets,
};
