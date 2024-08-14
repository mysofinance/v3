// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {OTokenImpl} from "./OTokenImpl.sol";

contract BTokenImpl is ERC20, Initializable, ReentrancyGuard {
    using SafeERC20 for IERC20Metadata;
    using Address for address;

    address public factory;
    address public oToken;
    uint8 internal _decimals;
    string private _name;
    string private _symbol;

    error InvalidAmount();
    error InvalidTime();
    error NothingToRedeem();
    error Unauthorized();

    constructor() ERC20("", "") {
        _disableInitializers();
    }

    /**
     * @notice Initializes the BToken contract with specified parameters.
     * @param __name The name of the token.
     * @param __symbol The symbol of the token.
     * @param __decimals The number of decimals for the token.
     * @param _oToken The address of the OToken contract.
     * @dev This function can only be called once, during the initialization phase.
     */
    function initialize(
        string memory __name,
        string memory __symbol,
        uint8 __decimals,
        address _oToken
    ) external initializer {
        if (_oToken == address(0)) {
            revert InvalidInitialization();
        }
        factory = msg.sender;
        _name = __name;
        _symbol = __symbol;
        _decimals = __decimals;
        oToken = _oToken;
    }

    /**
     * @notice Mints a specified amount of tokens to a given address.
     * @param to The address to mint tokens to.
     * @param amount The amount of tokens to mint.
     * @dev Can only be called by the factory.
     */
    function mint(address to, uint256 amount) external nonReentrant {
        if (msg.sender != factory) {
            revert Unauthorized();
        }
        _mint(to, amount);
    }

    /**
     * @notice Burns a specified amount of tokens from a given address.
     * @param from The address to burn tokens from.
     * @param amount The amount of tokens to burn.
     * @dev Can only be called by the OToken contract.
     */
    function burn(address from, uint256 amount) external nonReentrant {
        if (msg.sender != oToken) {
            revert Unauthorized();
        }
        _burn(from, amount);
    }

    /**
     * @notice Forwards settlement amount to a specified address.
     * @param to The address to forward the settlement tokens to.
     * @param amount The amount of settlement tokens to forward.
     * @dev Can only be called by the OToken contract.
     */
    function forwardSettlement(
        address to,
        uint256 amount
    ) external nonReentrant {
        if (msg.sender != oToken) {
            revert Unauthorized();
        }
        IERC20Metadata(OTokenImpl(oToken).settlementToken()).safeTransfer(
            to,
            amount
        );
    }

    /**
     * @notice Redeems the caller's balance for the underlying and settlement tokens.
     * @param to The address to send the redeemed tokens to.
     * @return proRataUnderlying The amount of underlying tokens to be received.
     * @return proRataSettlement The amount of settlement tokens to be received.
     * @return underlying The address of the underlying token.
     * @return settlementToken The address of the settlement token.
     * @return userBal The user's balance of BTokens.
     * @dev Can only be called after the option expiry.
     */
    function redeem(
        address to
    )
        external
        nonReentrant
        returns (
            uint256 proRataUnderlying,
            uint256 proRataSettlement,
            address underlying,
            address settlementToken,
            uint256 userBal
        )
    {
        if (block.timestamp <= OTokenImpl(oToken).expiry()) {
            revert InvalidTime();
        }
        (
            proRataUnderlying,
            proRataSettlement,
            underlying,
            settlementToken,
            userBal
        ) = redeemableAmounts(msg.sender);
        if (proRataUnderlying == 0 && proRataSettlement == 0) {
            revert NothingToRedeem();
        }
        _burn(msg.sender, userBal);
        if (proRataUnderlying > 0) {
            OTokenImpl(oToken).forwardUnderlying(to, proRataUnderlying);
        }
        if (proRataSettlement > 0) {
            IERC20Metadata(settlementToken).safeTransfer(to, proRataSettlement);
        }
    }

    /**
     * @notice Calculates the redeemable amounts for a specified account.
     * @param account The address of the account to calculate redeemable amounts for.
     * @return proRataUnderlying The amount of underlying tokens to be received.
     * @return proRataSettlement The amount of settlement tokens to be received.
     * @return underlying The address of the underlying token.
     * @return settlementToken The address of the settlement token.
     * @return userBal The user's balance of BTokens.
     * @dev Only calculates redeemable amounts if the option has expired.
     */
    function redeemableAmounts(
        address account
    )
        public
        view
        returns (
            uint256 proRataUnderlying,
            uint256 proRataSettlement,
            address underlying,
            address settlementToken,
            uint256 userBal
        )
    {
        underlying = OTokenImpl(oToken).underlying();
        settlementToken = OTokenImpl(oToken).settlementToken();
        userBal = balanceOf(account);
        if (block.timestamp > OTokenImpl(oToken).expiry()) {
            uint256 _totalSupply = totalSupply();
            if (_totalSupply > 0) {
                if (userBal == _totalSupply) {
                    proRataUnderlying = IERC20Metadata(underlying).balanceOf(
                        oToken
                    );
                    proRataSettlement = IERC20Metadata(settlementToken)
                        .balanceOf(address(this));
                } else {
                    proRataUnderlying =
                        (IERC20Metadata(underlying).balanceOf(oToken) *
                            userBal) /
                        _totalSupply;
                    proRataSettlement =
                        (IERC20Metadata(settlementToken).balanceOf(
                            address(this)
                        ) * userBal) /
                        _totalSupply;
                }
            }
        }
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function name() public view override returns (string memory) {
        return _name;
    }

    function symbol() public view override returns (string memory) {
        return _symbol;
    }
}
