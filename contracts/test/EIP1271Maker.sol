// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {Router} from "../Router.sol";
import {IEIP1271} from "../interfaces/IEIP1271.sol";

contract EIP1271Maker is Ownable, IEIP1271 {
    using SafeERC20 for IERC20Metadata;

    address public immutable router;
    mapping(address => bool) public isSigner;

    constructor(
        address _router,
        address _owner,
        address[] memory _signers
    ) Ownable(_owner) {
        router = _router;
        for (uint256 i = 0; i < _signers.length; ++i) {
            isSigner[_signers[i]] = true;
        }
    }

    function withdraw(
        address to,
        address token,
        uint256 amount
    ) external onlyOwner {
        IERC20Metadata(token).safeTransfer(to, amount);
    }

    function approve(
        address spender,
        address token,
        uint256 amount
    ) external onlyOwner {
        IERC20Metadata(token).approve(spender, amount);
    }

    function togglePauseQuotes() external onlyOwner {
        Router(router).togglePauseQuotes();
    }

    function toggleIsSigner(address[] memory _signers) external onlyOwner {
        for (uint256 i = 0; i < _signers.length; ++i) {
            isSigner[_signers[i]] = !isSigner[_signers[i]];
        }
    }

    function isValidSignature(
        bytes32 _hash,
        bytes memory _signature
    ) public view returns (bytes4 magicValue) {
        address signer = ECDSA.recover(
            MessageHashUtils.toEthSignedMessageHash(_hash),
            _signature
        );
        if (isSigner[signer]) {
            magicValue = 0x1626ba7e;
        }
    }
}
