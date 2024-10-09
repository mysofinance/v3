// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract FeeHandler is Ownable {
    using SafeERC20 for IERC20Metadata;

    uint256 internal constant BASE = 1 ether;
    uint96 internal constant MAX_MATCH_FEE = 0.2 ether;
    uint96 internal constant MAX_EXERCISE_FEE = 0.005 ether;

    address public router;
    uint96 public matchFee;
    uint96 public matchFeeDistPartnerShare;
    uint96 public exerciseFee;

    mapping(address => bool) public isDistPartner;

    event ProvisionFees(address indexed token, uint256 amount);
    event Withdraw(address indexed to, address indexed token, uint256 amount);
    event SetMatchFeeInfo(uint256 matchFee, uint256 distPartnerFeeShare);
    event SetExerciseFee(uint96 exerciseFee);
    event SetDistributionPartners(address[] accounts, bool[] isDistPartner);

    error InvalidMatchFee();
    error InvalidPartnerFeeShare();
    error InvalidExerciseFee();

    constructor(
        address initOwner,
        address _router,
        uint96 _matchFee,
        uint96 _distPartnerFeeShare,
        uint96 _exerciseFee
    ) Ownable(initOwner) {
        router = _router;
        setMatchFeeInfo(_matchFee, _distPartnerFeeShare);
        setExerciseFee(_exerciseFee);
    }

    function provisionFees(address token, uint256 amount) external {
        if (msg.sender != router) {
            revert();
        }
        // @dev: placeholder for distribution logic
        emit ProvisionFees(token, amount);
    }

    function withdraw(
        address to,
        address token,
        uint256 amount
    ) external onlyOwner {
        IERC20Metadata(token).safeTransfer(to, amount);
        emit Withdraw(to, token, amount);
    }

    function getMatchFeeInfo(
        address distPartner
    )
        external
        view
        returns (uint256 _matchFee, uint256 _matchFeeDistPartnerShare)
    {
        _matchFee = matchFee;
        _matchFeeDistPartnerShare = isDistPartner[distPartner]
            ? matchFeeDistPartnerShare
            : 0;
    }

    function setMatchFeeInfo(
        uint96 _matchFee,
        uint96 _distPartnerFeeShare
    ) public onlyOwner {
        if (_matchFee > MAX_MATCH_FEE) {
            revert InvalidMatchFee();
        }
        if (_distPartnerFeeShare > BASE) {
            revert InvalidPartnerFeeShare();
        }
        matchFee = _matchFee;
        matchFeeDistPartnerShare = _distPartnerFeeShare;
        emit SetMatchFeeInfo(_matchFee, _distPartnerFeeShare);
    }

    function setExerciseFee(uint96 _exerciseFee) public onlyOwner {
        if (_exerciseFee > MAX_EXERCISE_FEE) {
            revert InvalidExerciseFee();
        }
        exerciseFee = _exerciseFee;
        emit SetExerciseFee(_exerciseFee);
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
            isDistPartner[accounts[i]] = _isDistPartner[i];
            unchecked {
                ++i;
            }
        }

        emit SetDistributionPartners(accounts, _isDistPartner);
    }
}
