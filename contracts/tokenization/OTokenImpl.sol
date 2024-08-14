// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

import {InitializableERC20} from "./utils/InitializableERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC20Votes} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {BTokenImpl} from "./BTokenImpl.sol";
import {TokenizationFactory} from "./TokenizationFactory.sol";
import {Structs} from "./structs/Structs.sol";
import {IRewardDistributor} from "../interfaces/IRewardDistributor.sol";
import {IDelegation} from "./interfaces/IDelegation.sol";

contract OTokenImpl is InitializableERC20, ReentrancyGuard {
    using SafeERC20 for IERC20Metadata;
    using Address for address;

    uint256 constant BASE = 1 ether;
    uint256 constant SETTLEMENT_FEE = 0.0025 ether;
    address public factory;
    address public underlying;
    address public settlementToken;
    address public bToken;
    uint256 public strike;
    uint256 public expiry;
    uint256 public earliestExercise;
    bool public transferrable;
    bool public reverseExercisable;
    mapping(address target => mapping(string method => address caller))
        public allowedCalls;
    mapping(address user => uint256 amount) public reverseExercisableAmounts;
    error AmountTooLarge();
    error InvalidAmount();
    error InvalidOTokenInitialization();
    error ZeroSettlementAmount();
    error InvalidTime();
    error NonTransferrable();
    error NotReverseExercisable();
    error Unauthorized();

    /**
     * @notice Initializes the OToken contract with specified parameters.
     * @param __name The name of the token.
     * @param __symbol The symbol of the token.
     * @param __decimals The number of decimals for the token.
     * @param _bToken The address of the BToken contract.
     * @param mintConfig The configuration parameters for minting.
     * @dev This function can only be called once, during the initialization phase.
     */
    function initialize(
        string memory __name,
        string memory __symbol,
        uint8 __decimals,
        address _bToken,
        Structs.MintConfig memory mintConfig
    ) external initializer {
        if (
            mintConfig.strike == 0 ||
            mintConfig.expiry <= block.timestamp ||
            mintConfig.earliestExercise >= mintConfig.expiry ||
            _bToken == address(0)
        ) {
            revert InvalidOTokenInitialization();
        }
        factory = msg.sender;
        _name = __name;
        _symbol = __symbol;
        _decimals = __decimals;
        underlying = mintConfig.underlying;
        settlementToken = mintConfig.settlementToken;
        bToken = _bToken;
        strike = mintConfig.strike;
        expiry = mintConfig.expiry;
        earliestExercise = mintConfig.earliestExercise;
        transferrable = mintConfig.transferrable;
        reverseExercisable = mintConfig.reverseExercisable;

        for (uint256 i; i < mintConfig.allowedOTokenCalls.length; ) {
            Structs.AllowedCalls memory _allowedCalls = mintConfig
                .allowedOTokenCalls[i];
            allowedCalls[_allowedCalls.allowedTarget][
                _allowedCalls.allowedMethod
            ] = _allowedCalls.allowedCaller;
            unchecked {
                ++i;
            }
        }
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
     * @notice Delegates votes to a specified delegate.
     * @param hasERC20Votes Whether the token supports ERC20Votes.
     * @param delegate The address to delegate votes to.
     * @param delegateRegistry The address of the delegate registry.
     * @param spaceId The space ID for the delegate registry.
     * @dev Supports both on-chain and off-chain voting delegation.
     */
    function delegateVotes(
        bool hasERC20Votes,
        address delegate,
        address delegateRegistry,
        bytes32 spaceId
    ) external nonReentrant {
        if (msg.sender != factory) {
            revert Unauthorized();
        }
        // @dev: for on-chain voting via OZ ERC20Votes
        if (hasERC20Votes) {
            ERC20Votes(underlying).delegate(delegate);
        }
        // @dev: for off-chain voting via Gnosis Delegate Registry
        // see: https://docs.snapshot.org/user-guides/delegation#delegation-contract
        if (delegateRegistry != address(0) && spaceId != bytes32(0)) {
            IDelegation(delegateRegistry).setDelegate(spaceId, delegate);
        }
    }

    /**
     * @notice Exercises a specified amount of options.
     * @param to The address to send the exercised tokens to.
     * @param amount The amount of tokens to exercise.
     * @return settlementAmount The amount of settlement tokens to transfer.
     * @return settlementFee The settlement fee.
     * @return settlementFeesReceiver The fees receiver.
     * @dev User needs to approve settlementAmount + settlementFee
     */
    function exercise(
        address to,
        uint256 amount
    )
        external
        nonReentrant
        returns (
            uint256 settlementAmount,
            uint256 settlementFee,
            address settlementFeesReceiver
        )
    {
        if (block.timestamp > expiry || block.timestamp < earliestExercise) {
            revert InvalidTime();
        }
        if (amount == 0) {
            revert InvalidAmount();
        }
        (
            settlementAmount,
            settlementFee,
            settlementFeesReceiver
        ) = getSettlementAmount(amount);
        if (settlementAmount == 0) {
            revert ZeroSettlementAmount();
        }
        // @dev: reverseExercisableAmounts are non-transferrable
        if (reverseExercisable) {
            reverseExercisableAmounts[msg.sender] += amount;
        }
        _burn(msg.sender, amount);
        IERC20Metadata(underlying).safeTransfer(to, amount);
        address _settlementToken = settlementToken;
        IERC20Metadata(_settlementToken).safeTransferFrom(
            msg.sender,
            bToken,
            settlementAmount
        );
        if (settlementFeesReceiver != address(0) && settlementFee > 0) {
            _handleFees(
                true,
                settlementFeesReceiver,
                _settlementToken,
                settlementFee
            );
        }
    }

    /**
     * @notice Reverse exercises a specified amount of options.
     * @param to The address to send the settlement tokens to.
     * @param amount The amount of tokens to reverse exercise.
     * @return settlementAmount The amount of settlement tokens to transfer.
     * @return settlementFee The settlement fee.
     * @return settlementFeesReceiver The fees receiver.
     * @dev Can only be used if oToken is reverse exercisable.
     * @dev User only gets back settlementAmount - settlementFee.
     */
    function reverseExercise(
        address to,
        uint256 amount
    )
        external
        nonReentrant
        returns (
            uint256 settlementAmount,
            uint256 settlementFee,
            address settlementFeesReceiver
        )
    {
        if (!reverseExercisable) {
            revert NotReverseExercisable();
        }
        if (block.timestamp > expiry || block.timestamp < earliestExercise) {
            revert InvalidTime();
        }
        if (amount == 0) {
            revert InvalidAmount();
        }
        if (amount > reverseExercisableAmounts[msg.sender]) {
            revert AmountTooLarge();
        }
        (
            settlementAmount,
            settlementFee,
            settlementFeesReceiver
        ) = getSettlementAmount(amount);
        if (settlementAmount == 0) {
            revert ZeroSettlementAmount();
        }
        reverseExercisableAmounts[msg.sender] -= amount;
        _mint(msg.sender, amount);
        BTokenImpl(bToken).forwardSettlement(
            to,
            settlementAmount - settlementFee
        );
        if (settlementFeesReceiver != address(0) && settlementFee > 0) {
            _handleFees(
                false,
                settlementFeesReceiver,
                settlementToken,
                settlementFee
            );
        }
        IERC20Metadata(underlying).safeTransferFrom(
            msg.sender,
            address(this),
            amount
        );
    }

    /**
     * @notice Executes a specified method call on a target address.
     * @param target The address to call the method on.
     * @param method The method signature to call.
     * @param parameters The parameters to pass to the method.
     * @dev Only allowed callers can execute the method on the target address.
     */
    function call(
        address target,
        string memory method,
        bytes memory parameters
    ) external nonReentrant {
        if (msg.sender != allowedCalls[target][method]) {
            revert Unauthorized();
        }
        bytes4 selector = bytes4(keccak256(bytes(method)));
        target.functionCall(abi.encodePacked(selector, parameters));
    }

    /**
     * @notice Mints a specified amount of reverse tokens to a given address.
     * @param to The address to mint tokens to.
     * @param amount The amount of tokens to mint.
     * @dev The function checks for validity of mint time and amount.
     */
    function reverseMint(address to, uint256 amount) external nonReentrant {
        if (block.timestamp > expiry) {
            revert InvalidTime();
        }
        if (amount == 0) {
            revert InvalidAmount();
        }
        _burn(msg.sender, amount);
        BTokenImpl(bToken).burn(msg.sender, amount);
        IERC20Metadata(underlying).safeTransfer(to, amount);
    }

    /**
     * @notice Forwards underlying tokens to a specified address.
     * @param to The address to forward the underlying tokens to.
     * @param amount The amount of underlying tokens to forward.
     * @dev Can only be called by the BToken contract.
     */
    function forwardUnderlying(
        address to,
        uint256 amount
    ) external nonReentrant {
        if (msg.sender != bToken) {
            revert Unauthorized();
        }
        if (block.timestamp <= expiry) {
            revert InvalidTime();
        }
        IERC20Metadata(underlying).safeTransfer(to, amount);
    }

    /**
     * @notice Transfers tokens to a specified address.
     * @param to The address to transfer tokens to.
     * @param value The amount of tokens to transfer.
     * @return success True if the transfer was successful.
     * @dev Checks if the token is transferrable before executing the transfer.
     */
    function transfer(
        address to,
        uint256 value
    ) public override returns (bool) {
        if (transferrable) {
            return super.transfer(to, value);
        } else {
            revert NonTransferrable();
        }
    }

    /**
     * @notice Transfers tokens from one address to another.
     * @param from The address to transfer tokens from.
     * @param to The address to transfer tokens to.
     * @param value The amount of tokens to transfer.
     * @return success True if the transfer was successful.
     * @dev Checks if the token is transferrable before executing the transfer.
     */
    function transferFrom(
        address from,
        address to,
        uint256 value
    ) public override returns (bool) {
        if (transferrable) {
            return super.transferFrom(from, to, value);
        } else {
            revert NonTransferrable();
        }
    }

    /**
     * @notice Calculates the settlement amount.
     * @param amount The underlying amount.
     * @return settlementAmount The settlement amount.
     * @return settlementFee The settlement fee.
     * @return settlementFeesReceiver The fees receiver.
     */
    function getSettlementAmount(
        uint256 amount
    )
        public
        view
        returns (
            uint256 settlementAmount,
            uint256 settlementFee,
            address settlementFeesReceiver
        )
    {
        settlementAmount = (amount * strike) / 10 ** decimals();
        settlementFeesReceiver = TokenizationFactory(factory).feesReceiver();
        // @dev: if there's no fee receiver then fee is also zero
        if (settlementFeesReceiver != address(0)) {
            settlementFee = (settlementAmount * SETTLEMENT_FEE) / BASE;
        }
    }

    /**
     * @dev Handles fees and deposits into tlMYT if possible.
     * @param _isExercise Whether the fees shall be handled for
     * exercise (true) or reverse exercise (false).
     * @param _settlementFeesReceiver The settlement fees receiver.
     * @param _settlementToken The settlement token.
     * @param _settlementFee The settlement fee.
     */
    function _handleFees(
        bool _isExercise,
        address _settlementFeesReceiver,
        address _settlementToken,
        uint256 _settlementFee
    ) internal {
        // @dev: check whether token is a known reward token and catch
        // in case settlement fees receiver doesn't implement method
        try
            IRewardDistributor(_settlementFeesReceiver).isRewardToken(
                _settlementToken
            )
        returns (bool isRewardToken) {
            if (isRewardToken) {
                // @dev: if token is reward token, use deposit on tlMYT
                if (_isExercise) {
                    // @dev: if exercise, pull settlement tokens from sender
                    IERC20Metadata(_settlementToken).safeTransferFrom(
                        msg.sender,
                        address(this),
                        _settlementFee
                    );
                } else {
                    // @dev: if reverse exercise, get tokens from bToken
                    BTokenImpl(bToken).forwardSettlement(
                        address(this),
                        _settlementFee
                    );
                }

                IERC20Metadata(_settlementToken).safeIncreaseAllowance(
                    _settlementFeesReceiver,
                    _settlementFee
                );
                address[] memory tokens = new address[](1);
                uint256[] memory amounts = new uint256[](1);
                tokens[0] = _settlementToken;
                amounts[0] = _settlementFee;
                IRewardDistributor(_settlementFeesReceiver).depositRewards(
                    IRewardDistributor(_settlementFeesReceiver).currentEpoch() +
                        1,
                    tokens,
                    amounts
                );
            } else {
                // @dev: if token is not reward token simply forward
                if (_isExercise) {
                    // @dev: if exercise, pull settlement tokens from sender
                    IERC20Metadata(_settlementToken).safeTransferFrom(
                        msg.sender,
                        _settlementFeesReceiver,
                        _settlementFee
                    );
                } else {
                    // @dev: if reverse exercise, get tokens from bToken
                    BTokenImpl(bToken).forwardSettlement(
                        _settlementFeesReceiver,
                        _settlementFee
                    );
                }
            }
        } catch {
            // @dev: if cannot deposit to tlMYT simply forward
            if (_isExercise) {
                // @dev: if exercise, pull settlement tokens from sender
                IERC20Metadata(_settlementFeesReceiver).safeTransferFrom(
                    msg.sender,
                    _settlementFeesReceiver,
                    _settlementFee
                );
            } else {
                // @dev: if reverse exercise, get tokens from bToken
                BTokenImpl(bToken).forwardSettlement(
                    _settlementFeesReceiver,
                    _settlementFee
                );
            }
        }
    }
}
