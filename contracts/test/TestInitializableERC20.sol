// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Escrow} from "../Escrow.sol";

contract TestInitializableERC20 is Escrow {
    function anotherInitialize(
        string memory __name,
        string memory __symbol,
        uint8 __decimals
    ) external {
        _initializeERC20(__name, __symbol, __decimals);
    }
}
