// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// 1. Mock Token (Used for FXRP and USDC)
contract MockToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        _mint(msg.sender, 1000000 * 10**18); // Mint 1M tokens to deployer
    }
}

// 2. Mock DEX Router (Simulates Swaps)
contract MockDexRouter {
    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts) {
        amounts = new uint[](2);
        amounts[0] = amountIn;
        amounts[1] = amountIn; // 1:1 simulated price
        return amounts;
    }
}

// 3. Mock FDC Verification — always returns true for any proof
contract MockFdcVerification {
    function verifyMerkleProof(
        bytes32[] calldata /* proof */,
        bytes32 /* merkleRoot */,
        bytes32 /* leaf */
    ) external pure returns (bool) {
        return true;
    }
}

// 4. Mock Contract Registry — maps name strings to addresses
contract MockContractRegistry {
    mapping(string => address) private _contracts;

    function setContractAddress(string calldata _name, address _addr) external {
        _contracts[_name] = _addr;
    }

    function getContractAddressByName(string calldata _name) external view returns (address) {
        return _contracts[_name];
    }
}

// 5. Mock FTSO Registry — returns a fixed price for any symbol
contract MockFtsoRegistry {
    // Returns a fixed $0.50 price with 5 decimals (50000)
    function getCurrentPriceWithDecimals(
        string memory /* _symbol */
    ) external view returns (uint256 _price, uint256 _timestamp, uint256 _decimals) {
        return (50000, block.timestamp, 5);
    }
}