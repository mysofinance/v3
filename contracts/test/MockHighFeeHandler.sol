// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {FeeHandler} from "../feehandler/FeeHandler.sol";

contract MockHighFeeHandler is FeeHandler {
    constructor(
        address initOwner,
        uint96 _matchFee,
        uint96 _exerciseFee,
        uint96 _mintFee
    ) FeeHandler(initOwner, _matchFee, _exerciseFee, _mintFee) {}

    function setMatchFee(uint96 _matchFee) public override onlyOwner {
        matchFee = _matchFee;
        emit SetMatchFee(_matchFee);
    }

    function setExerciseFee(uint96 _exerciseFee) public override onlyOwner {
        exerciseFee = _exerciseFee;
        emit SetExerciseFee(_exerciseFee);
    }

    function setMintFee(uint96 _mintFee) public override onlyOwner {
        mintFee = _mintFee;
        emit SetMintFee(_mintFee);
    }

    function setDistPartnerFeeShares(
        address[] calldata accounts,
        uint256[] calldata feeShares
    ) external override onlyOwner {
        for (uint256 i = 0; i < accounts.length; ++i) {
            distPartnerFeeShare[accounts[i]] = feeShares[i];
        }
        emit SetDistPartnerFeeShares(accounts, feeShares);
    }
}
