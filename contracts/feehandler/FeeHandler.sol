// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Errors} from "../errors/Errors.sol";
import {IFeeHandler} from "../interfaces/IFeeHandler.sol";

contract FeeHandler is Ownable, IFeeHandler {
    using SafeERC20 for IERC20Metadata;

    uint256 internal constant BASE = 1 ether;
    uint96 internal constant MAX_MATCH_FEE = 0.2 ether;
    uint96 internal constant MAX_EXERCISE_FEE = 0.005 ether;

    uint96 public matchFee;
    uint96 public exerciseFee;
    uint96 public mintFee;

    mapping(address => uint256) public distPartnerFeeShare;

    constructor(
        address initOwner,
        uint96 _matchFee,
        uint96 _exerciseFee,
        uint96 _mintFee
    ) Ownable(initOwner) {
        setMatchFee(_matchFee);
        setExerciseFee(_exerciseFee);
        setMintFee(_mintFee);
    }

    function provisionFees(
        address /*token*/,
        uint256 /*amount*/
    ) external virtual {
        // @dev: placeholder to add fee distribution
        // logic in derived contracts
    }

    function withdraw(
        address to,
        address token,
        uint256 amount
    ) external virtual onlyOwner {
        IERC20Metadata(token).safeTransfer(to, amount);
        emit Withdraw(to, token, amount);
    }

    function getMatchFeeInfo(
        address distPartner
    )
        external
        view
        virtual
        returns (uint256 _matchFee, uint256 _matchFeeDistPartnerShare)
    {
        _matchFee = matchFee;
        _matchFeeDistPartnerShare = distPartnerFeeShare[distPartner];
    }

    function getMintFeeInfo(
        address distPartner
    )
        external
        view
        virtual
        returns (uint256 _mintFee, uint256 _mintFeeDistPartnerShare)
    {
        _mintFee = mintFee;
        _mintFeeDistPartnerShare = distPartnerFeeShare[distPartner];
    }

    function setDistPartnerFeeShares(
        address[] calldata accounts,
        uint256[] calldata feeShares
    ) external virtual onlyOwner {
        if (accounts.length == 0 || accounts.length != feeShares.length) {
            revert Errors.InvalidArrayLength();
        }
        for (uint256 i = 0; i < accounts.length; ++i) {
            if (feeShares[i] > BASE) {
                revert Errors.InvalidDistPartnerFeeShare();
            }
            if (distPartnerFeeShare[accounts[i]] == feeShares[i]) {
                revert Errors.DistPartnerUnchanged();
            }
            distPartnerFeeShare[accounts[i]] = feeShares[i];
        }

        emit SetDistPartnerFeeShares(accounts, feeShares);
    }

    function setMatchFee(uint96 _matchFee) public virtual onlyOwner {
        if (_matchFee > MAX_MATCH_FEE) {
            revert Errors.InvalidMatchFee();
        }
        matchFee = _matchFee;
        emit SetMatchFee(_matchFee);
    }

    function setExerciseFee(uint96 _exerciseFee) public virtual onlyOwner {
        if (_exerciseFee > MAX_EXERCISE_FEE) {
            revert Errors.InvalidExerciseFee();
        }
        exerciseFee = _exerciseFee;
        emit SetExerciseFee(_exerciseFee);
    }

    function setMintFee(uint96 _mintFee) public virtual onlyOwner {
        // @dev: use same fee cap as match fee
        if (_mintFee > MAX_MATCH_FEE) {
            revert Errors.InvalidMintFee();
        }
        mintFee = _mintFee;
        emit SetMintFee(_mintFee);
    }
}
