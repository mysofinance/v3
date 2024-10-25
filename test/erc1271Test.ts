const { expect } = require("chai");
const { ethers } = require("hardhat");
require("dotenv").config();

function signatureSplit(signatures: string, pos: number) {
  // Convert the signature to a byte array
  const signatureBytes = ethers.getBytes(signatures);

  // Calculate the position for the signature (65 bytes per signature)
  const signaturePos = pos * 65;

  // Extract r, s, and v from the signature using similar logic to Solidity
  const r = ethers.hexlify(
    signatureBytes.slice(signaturePos, signaturePos + 32)
  );
  const s = ethers.hexlify(
    signatureBytes.slice(signaturePos + 32, signaturePos + 64)
  );
  const v = ethers.toBeHex(signatureBytes[signaturePos + 64]); // last byte for `v`

  // Normalize v to 27 or 28 if necessary
  const normalizedV = v < 27 ? v + 27 : v;

  return { r, s, v: normalizedV };
}

function concatenateSignature(r: string, s: string, v: number): string {
  // Remove '0x' prefix from each part (r, s, v)
  const rNoPrefix = r.slice(2);
  const sNoPrefix = s.slice(2);
  const vHex = ethers.toBeHex(v).slice(2); // Convert v to hex and remove '0x'

  // Concatenate r, s, and v
  const concatenatedSignature = rNoPrefix + sNoPrefix + vHex;

  // Return the final signature with '0x' prefix
  return "0x" + concatenatedSignature;
}

describe("EIP-1271 isValidSignature Test", function () {
  it("should be possible to reconstruct a signature and verify it with checkNSignatures", async function () {
    const eip1271SignerKey = process.env.SEPOLIA_EIP_1271_SIGNER_KEY;
    if (!eip1271SignerKey) {
      throw new Error("EIP1271 signer key is not defined in the .env file");
    }
    const signer = new ethers.Wallet(eip1271SignerKey, ethers.provider);
    const signerAddress = await signer.getAddress();
    console.log("Signer Address:", signerAddress);

    // Safe 1-of-1 multisig contract on Arbitrum
    const eip1271SafeAddress = "0x6e96a002A8fDA96339b97674dcE5C02ab71bFC4c";

    // ABI fragment for the EIP-1271 interface
    const eip1271Abi = [
      "function getOwners() external view returns (address[])",
      "function checkNSignatures(bytes32 dataHash, bytes memory data, bytes memory signatures, uint256 requiredSignatures) public view",
    ];

    // Connect to the EIP-1271 multisig Safe contract
    const eip1271Contract = new ethers.Contract(
      eip1271SafeAddress,
      eip1271Abi,
      ethers.provider
    );

    // Retrieve current owners
    const owners = await eip1271Contract.getOwners();
    console.log("Contract Owners:", owners);

    // Check if the signer is the 1-of-1 multisig owner
    const isSignerAnOwner = owners.includes(signerAddress);
    expect(isSignerAnOwner).to.be.true;

    // Create the message and hash
    const message = "Hello World";
    const messageHash = ethers.solidityPackedKeccak256(["string"], [message]);
    console.log(messageHash);
    console.log(ethers.getBytes(messageHash));
    //const abiCoder = new ethers.AbiCoder();
    //const message = abiCoder.encode(["string"], ["hello"]);
    //const messageHash = ethers.keccak256(message);

    // Sign the message
    const signature = await signer.signMessage(ethers.getBytes(messageHash));
    console.log("Raw Signature:", signature);

    // Recover the address off-chain using ethers.verifyMessage
    const recoveredAddress = ethers.verifyMessage(
      ethers.getBytes(messageHash),
      signature
    );
    console.log("Recovered Address Off-Chain:", recoveredAddress);

    // Ensure that the recovered address matches the signer's address
    expect(recoveredAddress).to.equal(signerAddress);

    // Split the signature into its components (r, s, v)
    const { v, r, s } = ethers.Signature.from(signature);
    console.log(`r: ${r}, s: ${s}, v: ${v}`);

    // Concatenate r, s, and v into a single signature
    // Shift v by 4 to match Safe logic to check against pre-fixed signature
    const packedSignature = ethers.concat([r, s, ethers.toBeHex(v + 4, 1)]);
    console.log("Packed Signature:", packedSignature);

    const TestRecover = await ethers.getContractFactory("TestRecover");
    const testRecover = await TestRecover.deploy();
    const val = await testRecover.testRecover(
      ethers.getBytes(messageHash),
      signature
    );
    console.log("val", val);
    expect(val).to.be.equal(signer);
    await eip1271Contract.checkNSignatures(
      ethers.getBytes(messageHash),
      "0x",
      packedSignature,
      1
    );
  });

  it("Should call isValidSignature and check the return value using nonSafeMessageHash", async function () {
    const eip1271SignerKey = process.env.SEPOLIA_EIP_1271_SIGNER_KEY;
    if (!eip1271SignerKey) {
      throw new Error("EIP1271 signer key is not defined in the .env file");
    }
    const signer = new ethers.Wallet(eip1271SignerKey, ethers.provider);
    const signerAddress = await signer.getAddress();
    console.log("signerAddress:", signerAddress);

    // Safe 1-of-1 multisig contract on Arbitrum
    const eip1271SafeAddress = "0x6e96a002A8fDA96339b97674dcE5C02ab71bFC4c";

    // ABI fragment for the EIP-1271 interface
    const eip1271Abi = [
      "function getOwners() external view returns (address[])",
      "function checkNSignatures(bytes32 dataHash, bytes memory data, bytes memory signatures, uint256 requiredSignatures) public view",
      "function isValidSignature(bytes32 _dataHash, bytes calldata _signature) external view returns (bytes4)",
    ];

    // Connect to the EIP-1271 multisig Safe contract
    const eip1271Contract = new ethers.Contract(
      eip1271SafeAddress,
      eip1271Abi,
      ethers.provider
    );

    // Call the getOwners function to retrieve the current owners
    const owners = await eip1271Contract.getOwners();

    // Check signer matches 1-of-1 multisig owner
    const isSignerAnOwner = owners.includes(signerAddress);
    expect(isSignerAnOwner).to.be.true;

    // Prepare message
    const abiCoder = new ethers.AbiCoder();
    const nonSafeMessage = abiCoder.encode(["string"], ["hello"]);
    const nonSafeMessageHash = ethers.keccak256(nonSafeMessage);

    // Get corresponding Safe message hash and sign
    const safeCallbackContractAddress =
      "0xfd0732dc9e303f09fcef3a7388ad10a83459ec99";
    const safeCallbackAbi = [
      "function encodeMessageDataForSafe(address safe, bytes memory message) public view returns (bytes memory)",
    ];
    const safeCallbackContract = new ethers.Contract(
      safeCallbackContractAddress,
      safeCallbackAbi,
      signer
    );
    const safeEncodedMessage =
      await safeCallbackContract.encodeMessageDataForSafe(
        eip1271SafeAddress,
        nonSafeMessageHash
      );
    const safeMessageHash = ethers.keccak256(safeEncodedMessage);
    const signature = await signer.signMessage(
      ethers.getBytes(safeMessageHash)
    );

    const { v, r, s } = ethers.Signature.from(signature);
    console.log(`r: ${r}, s: ${s}, v: ${v}`);

    // Concatenate r, s, and v into a single signature
    // Shift v by 4 to match Safe logic to check against pre-fixed signature
    const packedSignature = ethers.concat([r, s, ethers.toBeHex(v + 4, 1)]);

    await eip1271Contract.checkNSignatures(
      ethers.getBytes(safeMessageHash),
      "0x",
      packedSignature,
      1
    );

    // Check if is valid EIP-1271 signature
    await eip1271Contract.isValidSignature(
      ethers.getBytes(nonSafeMessageHash),
      packedSignature
    );
  });
});
