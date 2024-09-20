// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract FeeHandler is Ownable {
    using SafeERC20 for IERC20Metadata;

    uint256 public constant MAX_FEE = 0.2 ether;
    uint256 public constant BASE = 1 ether;

    uint256 public totalFeePct;
    uint256 public distPartnerFeeShare;
    mapping(address => bool) public isDistPartner;

    event Collect(address indexed token, uint256 amount);
    event SetFees(uint256 totalFeePct, uint256 distPartnerFeeShare);
    event SetDistributionPartners(address[] accounts, bool[] isDistPartner);

    error FeeExceedsMaximum(uint256 maxFee);
    error InvalidPartnerFeeShare(uint256 maxShare);
    error FeeAlreadySet();

    constructor(
        address initOwner,
        uint256 _totalFeePct,
        uint256 _distPartnerFeeShare
    ) Ownable(initOwner) {
        setFees(_totalFeePct, _distPartnerFeeShare);
    }

    function calcFees(
        address /*premiumToken*/,
        uint256 premium,
        address distPartner
    ) external view returns (uint256 protocolFee, uint256 distPartnerFee) {
        uint256 _distPartnerFeeShare = isDistPartner[distPartner]
            ? distPartnerFeeShare
            : 0;
        protocolFee =
            (premium * totalFeePct * (BASE - _distPartnerFeeShare)) /
            BASE;
        distPartnerFee = (premium * totalFeePct * _distPartnerFeeShare) / BASE;
    }

    function collect(address token, uint256 amount) external {
        IERC20Metadata(token).safeTransferFrom(
            msg.sender,
            address(this),
            amount
        );
        emit Collect(token, amount);
    }

    function setFees(
        uint256 _totalFeePct,
        uint256 _distPartnerFeeShare
    ) public onlyOwner {
        if (_totalFeePct > MAX_FEE) {
            revert FeeExceedsMaximum(MAX_FEE);
        }
        if (_distPartnerFeeShare > BASE) {
            revert InvalidPartnerFeeShare(BASE);
        }
        if (
            _totalFeePct == totalFeePct ||
            _distPartnerFeeShare == distPartnerFeeShare
        ) {
            revert FeeAlreadySet();
        }
        totalFeePct = _totalFeePct;
        distPartnerFeeShare = _distPartnerFeeShare;

        emit SetFees(_totalFeePct, _distPartnerFeeShare);
    }

    function setDistPartners(
        address[] calldata accounts,
        bool[] calldata _isDistPartner
    ) public onlyOwner {
        if (accounts.length == 0 || accounts.length != _isDistPartner.length) {
            revert();
        }
        for (uint256 i; i < accounts.length; ) {
            if (isDistPartner[accounts[i]] == _isDistPartner[i]) {
                revert();
            }
            isDistPartner[accounts[i]] == _isDistPartner[i];
            unchecked {
                ++i;
            }
        }

        emit SetDistributionPartners(accounts, _isDistPartner);
    }
}
