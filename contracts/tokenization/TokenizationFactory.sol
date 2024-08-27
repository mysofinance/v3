// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {OTokenImpl} from "./OTokenImpl.sol";
import {BTokenImpl} from "./BTokenImpl.sol";
import {TokenizationDataTypes} from "./datatypes/TokenizationDataTypes.sol";

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

    uint256 public nonRemintableCounter;
    address public feesReceiver;
    address public immutable oTokenImpl;
    address public immutable bTokenImpl;
    mapping(bytes32 mintId => bool exists) public exists;
    mapping(bytes32 mintId => address oToken) public oTokens;
    mapping(bytes32 mintId => address bToken) public bTokens;

    address[] internal _oTokens;
    address[] internal _bTokens;

    error Invalid();
    error InvalidSignature();
    error InvalidTokens();
    error InvalidMint();
    error CannotMintAfterExpiry(uint256 expiry);

    constructor(
        address _owner,
        address _oTokenImpl,
        address _bTokenImpl,
        address _feesReceiver
    ) Ownable(_owner) {
        oTokenImpl = _oTokenImpl;
        bTokenImpl = _bTokenImpl;
        feesReceiver = _feesReceiver;
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
        TokenizationDataTypes.MintConfig memory mintConfig
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
     * @param from Index to start retrieving tokens from.
     * @param numElements Number of tokens to retrieve.
     * @return mintedOTokens Array of oToken addresses.
     * @return mintedBTokens Array of bToken addresses.
     */
    function getTokens(
        uint256 from,
        uint256 numElements
    )
        external
        view
        returns (address[] memory mintedOTokens, address[] memory mintedBTokens)
    {
        uint256 length = _bTokens.length;
        if (numElements == 0 || from + numElements > length + 1) {
            revert Invalid();
        }
        mintedOTokens = new address[](numElements);
        mintedBTokens = new address[](numElements);
        for (uint256 i; i < numElements; ) {
            mintedOTokens[i] = _oTokens[from + i];
            mintedBTokens[i] = _bTokens[from + i];
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
        TokenizationDataTypes.MintConfig memory mintConfig
    ) public view returns (bytes32 mintId) {
        mintId = keccak256(
            abi.encode(
                mintConfig.baseMintConfig.remintable
                    ? 0
                    : nonRemintableCounter + 1,
                mintConfig
            )
        );
    }

    function _mint(
        address spender,
        address oTokenTo,
        address bTokenTo,
        uint256 amount,
        TokenizationDataTypes.MintConfig memory mintConfig
    ) internal returns (address oToken, address bToken, bytes32 mintId) {
        if (
            mintConfig.underlying == address(0) ||
            mintConfig.settlementToken == address(0) ||
            mintConfig.underlying == mintConfig.settlementToken
        ) {
            revert InvalidMint();
        }
        mintId = getMintId(mintConfig);
        if (!exists[mintId]) {
            oToken = Clones.cloneDeterministic(oTokenImpl, mintId);
            bToken = Clones.cloneDeterministic(bTokenImpl, mintId);
            oTokens[mintId] = oToken;
            bTokens[mintId] = bToken;
            _oTokens.push(oToken);
            _bTokens.push(bToken);
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
        if (!mintConfig.baseMintConfig.remintable) {
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
            mintConfig.baseMintConfig.hasERC20Votes,
            mintConfig.baseMintConfig.votingDelegate,
            mintConfig.baseMintConfig.delegateRegistry,
            mintConfig.baseMintConfig.spaceId
        );
    }
}
