// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {FeeHandler} from "../feehandler/FeeHandler.sol";

contract MockHighFeeHandler is FeeHandler {
    constructor(
        address initOwner,
        address _router,
        uint96 _matchFee,
        uint96 _distPartnerFeeShare,
        uint96 _exerciseFee
    )
        FeeHandler(
            initOwner,
            _router,
            _matchFee,
            _distPartnerFeeShare,
            _exerciseFee
        )
    {}

    function setMatchFeeInfo(
        uint96 _matchFee,
        uint96 _distPartnerFeeShare
    ) public override onlyOwner {
        matchFee = _matchFee;
        matchFeeDistPartnerShare = _distPartnerFeeShare;
        emit SetMatchFeeInfo(_matchFee, _distPartnerFeeShare);
    }

    function setExerciseFee(uint96 _exerciseFee) public override onlyOwner {
        exerciseFee = _exerciseFee;
        emit SetExerciseFee(_exerciseFee);
    }
}
