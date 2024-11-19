// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {Errors} from "../errors/Errors.sol";

contract InitializableERC20 is ERC20, Initializable {
    bool private _initialized;
    uint8 private _decimals;
    string private _name;
    string private _symbol;

    constructor() ERC20("", "") {
        _disableInitializers();
    }

    function _initializeERC20(
        string memory __name,
        string memory __symbol,
        uint8 __decimals
    ) internal {
        if (_initialized) {
            revert Errors.AlreadyInitialized();
        }
        _initialized = true;
        _name = __name;
        _symbol = __symbol;
        _decimals = __decimals;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function name() public view override returns (string memory) {
        return _name;
    }

    function symbol() public view override returns (string memory) {
        return _symbol;
    }
}
