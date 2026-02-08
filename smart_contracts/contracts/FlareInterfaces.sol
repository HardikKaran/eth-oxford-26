// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

// 1. The Registry (The Phonebook)
// On Flare, we don't hardcode addresses. We ask the Registry.
interface IFlareContractRegistry {
    function getContractAddressByName(string calldata _name) external view returns (address);
}

// 2. FTSO Registry (The Price Feed)
// Used to get the price of FLR/USD, BTC/USD, etc.
interface IFtsoRegistry {
    function getCurrentPriceWithDecimals(
        string memory _symbol
    ) external view returns (
        uint256 _price, 
        uint256 _timestamp, 
        uint256 _decimals
    );
}

// 3. FDC Verification (The Truth Machine)
// Used to verify that your Merkle Proof matches the Root stored on-chain.
interface IFdcVerification {
    function verifyMerkleProof(
        bytes32[] calldata proof,
        bytes32 merkleRoot,
        bytes32 leaf
    ) external view returns (bool);
}

// 4. FTSO V2 Interface (Optional - for high-speed updates if needed)
interface IFtsoV2 {
    function getFeedById(bytes21 _feedId) external view returns (uint256, int8, uint64);
}