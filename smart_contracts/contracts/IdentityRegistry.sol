// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";

contract IdentityRegistry is Ownable {
    
    // Mapping to check if a user is verified
    mapping(address => bool) public isVerified;

    event UserVerified(address indexed user);
    event UserRemoved(address indexed user);

    constructor() Ownable(msg.sender) {}

    // CALL THIS: From your backend after Government ID check passes
    function addVerifiedUser(address _user) external onlyOwner {
        isVerified[_user] = true;
        emit UserVerified(_user);
    }

    function removeVerifiedUser(address _user) external onlyOwner {
        isVerified[_user] = false;
        emit UserRemoved(_user);
    }

    // A helper to easily check status from other contracts
    function checkVerified(address _user) external view returns (bool) {
        return isVerified[_user];
    }
}