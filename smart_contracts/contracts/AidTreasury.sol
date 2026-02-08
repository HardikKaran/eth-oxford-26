// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./FlareInterfaces.sol";

interface IDexRouter {
    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts);
}

contract AidTreasury is Ownable {
    // 1. We removed the hardcoded constant. 
    // Now we store the registry address in this variable.
    IFlareContractRegistry public registry;
    
    IDexRouter public dexRouter;
    address public missionControl;
    address public fxrpToken; 
    address public usdcToken;

    // 2. UPDATED CONSTRUCTOR: Now accepts 4 arguments!
    constructor(
        address _dexRouter,
        address _fxrpToken,
        address _usdcToken,
        address _registry // <--- This was missing!
    ) Ownable(msg.sender) {
        registry = IFlareContractRegistry(_registry); // Set it here
        dexRouter = IDexRouter(_dexRouter);
        fxrpToken = _fxrpToken;
        usdcToken = _usdcToken;
    }

    function setMissionControl(address _mc) external onlyOwner {
        missionControl = _mc;
    }

    modifier onlyMissionControl() {
        require(msg.sender == missionControl, "Caller is not Mission Control");
        _;
    }

    function processPayout(address _provider, uint256 _usdAmount) external onlyMissionControl {
        address ftsoRegistryAddr = registry.getContractAddressByName("FtsoRegistry");
        IFtsoRegistry ftso = IFtsoRegistry(ftsoRegistryAddr);

        (uint256 price, , uint256 decimals) = ftso.getCurrentPriceWithDecimals("FXRP");
        require(price > 0, "Invalid FTSO Price");

        // Calculate Swap Amount
        uint256 fxrpNeeded = (_usdAmount * (10**decimals)) / price; 
        
        IERC20(fxrpToken).approve(address(dexRouter), fxrpNeeded);
        
        address[] memory path = new address[](2);
        path[0] = fxrpToken;
        path[1] = usdcToken;

        dexRouter.swapExactTokensForTokens(
            fxrpNeeded,
            0, 
            path,
            _provider, 
            block.timestamp + 300
        );
    }
}