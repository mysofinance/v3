// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {OTokenImpl} from "./OTokenImpl.sol";
import {BTokenImpl} from "./BTokenImpl.sol";
import {Structs} from "./structs/Structs.sol";

/**
 * @title TokenizationFactory
 * @notice TokenizationFactory allows any user to split any ERC20 into an option token (oToken)
 * and base token (bToken). The oToken allows the holder to purchase the underlying at a set
 * strike price before expiry but not earlier than the earliest exercise date, emulating both
 * American and European style options.
 * The bToken corresponds to a covered call token where the holder will either receive the
 * settlement proceeds from oToken exercise or the unexercised underlying amount. Users who hold
 * both the oToken and bToken can redeem them for the underlying any time before expiry,
 * reversing the minting operation.
 *
 * The oToken is the "lead token" and is collateralized with the underlying amount and handles
 * all logic for exercising the option. The bToken is the "following token" and holds all relevant
 * settlement proceeds. If and only if there is any unclaimed underlying post expiry, these
 * proceeds can be accessed by the bToken for claiming.
 */
contract TokenizationFactory is Ownable {
    using SafeERC20 for IERC20Metadata;

    uint256 public version;
    uint256 public nonRemintableCounter;
    address public feesReceiver;
    mapping(uint256 version => address oTokenImpl) public oTokenImpl;
    mapping(uint256 version => address bTokenImpl) public bTokenImpl;
    mapping(bytes32 mintId => bool exists) public exists;
    mapping(bytes32 mintId => address oToken) public oTokens;
    mapping(bytes32 mintId => address bToken) public bTokens;

    mapping(uint256 version => address[] oToken) internal _oTokens;
    mapping(uint256 version => address[] bToken) internal _bTokens;

    error Invalid();
    error InvalidSignature();
    error InvalidTokens();
    error InvalidVersion();
    error InvalidMint();
    error CannotMintAfterExpiry(uint256 expiry);

    constructor(
        address _owner,
        address _oTokenImpl,
        address _bTokenImpl,
        address _feesReceiver
    ) Ownable(_owner) {
        oTokenImpl[0] = _oTokenImpl;
        bTokenImpl[0] = _bTokenImpl;
        feesReceiver = _feesReceiver;
    }

    /**
     * @notice Updates the implementation addresses for oToken and bToken.
     * @dev This function increments the version and sets the new
     * @dev implementation addresses for oToken and bToken.
     * @param newOTokenImpl The address of the new oToken implementation.
     * @param newBTokenImpl The address of the new bToken implementation.
     */
    function updateTokenImpl(
        address newOTokenImpl,
        address newBTokenImpl
    ) external onlyOwner {
        uint256 _newVersion = ++version;
        oTokenImpl[_newVersion] = newOTokenImpl;
        bTokenImpl[_newVersion] = newBTokenImpl;
    }

    /**
     * @notice Sets the settlement fees receiver address.
     * @param _feesReceiver The address to receive settlement fees.
     */
    function setFeesReceiver(address _feesReceiver) external onlyOwner {
        feesReceiver = _feesReceiver;
    }

    /**
     * @notice Lets user mint oToken and bToken from underlying.
     * @param oTokenTo Recipient address of the oToken.
     * @param bTokenTo Recipient address of the bToken.
     * @param amount The amount of underlying to use for minting.
     * @param mintConfig The mint config.
     * @return oToken The oToken address.
     * @return bToken The bToken address.
     * @return mintId The mintId.
     */
    function mint(
        address oTokenTo,
        address bTokenTo,
        uint256 amount,
        Structs.MintConfig memory mintConfig
    ) external returns (address oToken, address bToken, bytes32 mintId) {
        (oToken, bToken, mintId) = _mint(
            msg.sender,
            oTokenTo,
            bTokenTo,
            amount,
            mintConfig
        );
    }

    /**
     * @notice Retrieve a list of minted oTokens and bTokens.
     * @param _version Implementation version.
     * @param from Index to start retrieving tokens from.
     * @param numElements Number of tokens to retrieve.
     * @return mintedOTokens Array of oToken addresses.
     * @return mintedBTokens Array of bToken addresses.
     */
    function getTokens(
        uint256 _version,
        uint256 from,
        uint256 numElements
    )
        external
        view
        returns (address[] memory mintedOTokens, address[] memory mintedBTokens)
    {
        uint256 length = _bTokens[_version].length;
        if (numElements == 0 || from + numElements > length + 1) {
            revert Invalid();
        }
        mintedOTokens = new address[](numElements);
        mintedBTokens = new address[](numElements);
        for (uint256 i; i < numElements; ) {
            mintedOTokens[i] = _oTokens[_version][from + i];
            mintedBTokens[i] = _bTokens[_version][from + i];
            unchecked {
                ++i;
            }
        }
        return (mintedOTokens, mintedBTokens);
    }

    /**
     * @notice Generate a unique mint ID for given parameters.
     * @param mintConfig The mint config.
     * @return mintId The mint ID.
     */
    function getMintId(
        Structs.MintConfig memory mintConfig
    ) public view returns (bytes32 mintId) {
        mintId = keccak256(
            abi.encode(
                version,
                mintConfig.remintable ? 0 : nonRemintableCounter + 1,
                mintConfig
            )
        );
    }

    function _mint(
        address spender,
        address oTokenTo,
        address bTokenTo,
        uint256 amount,
        Structs.MintConfig memory mintConfig
    ) internal returns (address oToken, address bToken, bytes32 mintId) {
        if (mintConfig.version != version) {
            revert InvalidVersion();
        }
        if (
            mintConfig.underlying == address(0) ||
            mintConfig.settlementToken == address(0) ||
            mintConfig.underlying == mintConfig.settlementToken
        ) {
            revert InvalidMint();
        }
        mintId = getMintId(mintConfig);
        if (!exists[mintId]) {
            oToken = Clones.cloneDeterministic(
                oTokenImpl[mintConfig.version],
                mintId
            );
            bToken = Clones.cloneDeterministic(
                bTokenImpl[mintConfig.version],
                mintId
            );
            oTokens[mintId] = oToken;
            bTokens[mintId] = bToken;
            _oTokens[version].push(oToken);
            _bTokens[version].push(bToken);
            string memory name = IERC20Metadata(mintConfig.underlying).name();
            string memory symbol = IERC20Metadata(mintConfig.underlying)
                .symbol();
            uint8 decimals = IERC20Metadata(mintConfig.underlying).decimals();
            OTokenImpl(oToken).initialize(
                string(abi.encodePacked("oToken ", name)),
                string(abi.encodePacked("o", symbol)),
                decimals,
                bToken,
                mintConfig
            );
            BTokenImpl(bToken).initialize(
                string(abi.encodePacked("bToken ", name)),
                string(abi.encodePacked("b", symbol)),
                decimals,
                oToken
            );
        } else {
            oToken = oTokens[mintId];
            bToken = bTokens[mintId];
            if (block.timestamp > mintConfig.expiry) {
                revert CannotMintAfterExpiry(mintConfig.expiry);
            }
        }
        if (!mintConfig.remintable) {
            nonRemintableCounter++;
        }
        OTokenImpl(oToken).mint(oTokenTo, amount);
        BTokenImpl(bToken).mint(bTokenTo, amount);
        IERC20Metadata(mintConfig.underlying).safeTransferFrom(
            spender,
            oToken,
            amount
        );
        // @dev: note in case of reminting, all voting power will
        // be sent according to given previously minted voting configuration
        OTokenImpl(oToken).delegateVotes(
            mintConfig.hasERC20Votes,
            mintConfig.votingDelegate,
            mintConfig.delegateRegistry,
            mintConfig.spaceId
        );
    }
}
