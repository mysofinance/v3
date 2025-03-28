// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {DataTypes} from "../DataTypes.sol";
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

    mapping(address => mapping(address => DataTypes.MatchFeePerPair))
        public matchFeePerPair;
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
        address distPartner,
        uint128 /*optionPremium*/,
        DataTypes.OptionInfo calldata optionInfo
    )
        external
        view
        virtual
        returns (uint256 _matchFee, uint256 _matchFeeDistPartnerShare)
    {
        DataTypes.MatchFeePerPair memory _matchFeePerPair = matchFeePerPair[
            optionInfo.underlyingToken
        ][optionInfo.settlementToken];
        // @dev: use pair specific match fee if set; else use general match fee;
        // additional match fee rules can be added in derived contracts
        _matchFee = _matchFeePerPair.isSet
            ? _matchFeePerPair.matchFee
            : matchFee;
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
                revert Errors.DistPartnerFeeUnchanged();
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

    function setMatchFeesPerPair(
        address[] calldata underlyingTokens,
        address[] calldata settlementTokens,
        DataTypes.MatchFeePerPair[] calldata _matchFeesPerPair
    ) public virtual onlyOwner {
        uint256 length = underlyingTokens.length;
        if (
            length == 0 ||
            length != settlementTokens.length ||
            length != _matchFeesPerPair.length
        ) {
            revert Errors.InvalidArrayLength();
        }

        for (uint256 i = 0; i < length; ++i) {
            DataTypes.MatchFeePerPair memory feePerPair = _matchFeesPerPair[i];

            if (feePerPair.isSet) {
                if (feePerPair.matchFee > MAX_MATCH_FEE) {
                    revert Errors.InvalidMatchFee();
                }
                matchFeePerPair[underlyingTokens[i]][
                    settlementTokens[i]
                ] = feePerPair;
            } else {
                delete matchFeePerPair[underlyingTokens[i]][
                    settlementTokens[i]
                ];
            }
        }

        emit SetMatchFeesPerPair(
            underlyingTokens,
            settlementTokens,
            _matchFeesPerPair
        );
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
