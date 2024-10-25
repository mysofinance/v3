// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

contract TestRecover {

    function testRecover(bytes32 dataHash, bytes memory signatures) public pure returns (address) {
        require(signatures.length >= 65, "Invalid signature length");

        uint8 v;
        bytes32 r;
        bytes32 s;

        assembly {
            r := mload(add(signatures, 0x20))
            s := mload(add(signatures, 0x40))
            v := byte(0, mload(add(signatures, 0x60)))
        }

        if (v < 27) {
            v += 27;
        }

        return ecrecover(keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", dataHash)), v, r, s);
    }
}