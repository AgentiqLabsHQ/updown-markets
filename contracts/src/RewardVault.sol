// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable2Step, Ownable } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IRewardVault } from "./interfaces/IRewardVault.sol";

/// @notice Isolated reward custody for the protocol. Only the BattleManager (`manager`) may move
/// funds; the owner maintains the reward-token allowlist and the recovery beneficiary. Each
/// battle is funded in exactly one allowlisted token (native ETH via address(0), or an ERC-20) —
/// there is no "platform fee" balance here: everything held is either an active reward pool or,
/// once expired and unclaimed, recoverable to the beneficiary. Keeping all value in one small,
/// guarded contract shrinks the audit surface of the money layer.
contract RewardVault is IRewardVault, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public manager;
    address public recoveryBeneficiary;

    mapping(address => bool) public allowedTokens;
    /// @dev Storage is scoped by (manager, battleId), NOT battleId alone. `manager` is
    /// reassignable (`setManager`) — e.g. redeploying BattleManager to ship a fix — and each
    /// manager instance numbers its own battles starting from 1. Without this scoping, a fresh
    /// manager's battle #1 would collide with whatever a previous manager instance already left
    /// under that same numeric ID in this reused vault (this happened in practice: see
    /// contracts/deployments/46630-v2.1.json). Every write below uses `msg.sender`, which
    /// `onlyManager` already guarantees equals the current `manager` — so a battle's funds stay
    /// keyed to the exact manager that created it, permanently, even after `manager` changes.
    mapping(address => mapping(uint256 => address)) private _battleToken;
    mapping(address => mapping(uint256 => uint256)) private _battleBalance;

    event ManagerUpdated(address indexed manager);
    event RecoveryBeneficiaryUpdated(address indexed beneficiary);
    event TokenAllowlisted(address indexed token, bool allowed);
    event Collected(uint256 indexed battleId, address indexed token, address indexed from, uint256 amount);
    event PaidOut(uint256 indexed battleId, address indexed to, uint256 amount);
    event Recovered(uint256 indexed battleId, address indexed to, uint256 amount);

    error NotManager();
    error InsufficientBattleBalance();
    error InvalidToken();
    error BattleTokenMismatch();
    error ZeroAddress();
    error NativeTransferFailed();

    modifier onlyManager() {
        if (msg.sender != manager) revert NotManager();
        _;
    }

    constructor(address initialOwner, address recoveryBeneficiary_) Ownable(initialOwner) {
        if (initialOwner == address(0) || recoveryBeneficiary_ == address(0)) revert ZeroAddress();
        recoveryBeneficiary = recoveryBeneficiary_;
    }

    function setManager(address manager_) external onlyOwner {
        if (manager_ == address(0)) revert ZeroAddress();
        manager = manager_;
        emit ManagerUpdated(manager_);
    }

    function setRecoveryBeneficiary(address beneficiary) external onlyOwner {
        if (beneficiary == address(0)) revert ZeroAddress();
        recoveryBeneficiary = beneficiary;
        emit RecoveryBeneficiaryUpdated(beneficiary);
    }

    /// @notice Allowlist (or de-allowlist) a reward token. Pass address(0) to allow native ETH.
    function setTokenAllowed(address token, bool allowed) external onlyOwner {
        allowedTokens[token] = allowed;
        emit TokenAllowlisted(token, allowed);
    }

    /// @inheritdoc IRewardVault
    function collect(uint256 battleId, address token, address from, uint256 amount)
        external
        payable
        onlyManager
    {
        if (!allowedTokens[token]) revert InvalidToken();
        address existing = _battleToken[msg.sender][battleId];
        if (existing == address(0) && _battleBalance[msg.sender][battleId] == 0) {
            _battleToken[msg.sender][battleId] = token;
        } else if (existing != token) {
            revert BattleTokenMismatch();
        }
        _battleBalance[msg.sender][battleId] += amount;
        if (token == address(0)) {
            if (msg.value != amount) revert InvalidToken();
        } else {
            IERC20(token).safeTransferFrom(from, address(this), amount);
        }
        emit Collected(battleId, token, from, amount);
    }

    /// @inheritdoc IRewardVault
    function payout(uint256 battleId, address to, uint256 amount) external onlyManager nonReentrant {
        if (amount > _battleBalance[msg.sender][battleId]) revert InsufficientBattleBalance();
        _battleBalance[msg.sender][battleId] -= amount;
        _send(_battleToken[msg.sender][battleId], to, amount);
        emit PaidOut(battleId, to, amount);
    }

    /// @inheritdoc IRewardVault
    function recoverExpired(uint256 battleId) external onlyManager nonReentrant {
        uint256 amount = _battleBalance[msg.sender][battleId];
        if (amount == 0) return;
        _battleBalance[msg.sender][battleId] = 0;
        _send(_battleToken[msg.sender][battleId], recoveryBeneficiary, amount);
        emit Recovered(battleId, recoveryBeneficiary, amount);
    }

    /// @inheritdoc IRewardVault
    /// @dev Reports the CURRENT manager's view of this battle ID — matches every existing
    /// caller's expectation of "the active battle with this ID". Use `battleTokenFor`/
    /// `battleBalanceFor` to inspect a specific (possibly superseded) manager's data instead.
    function battleToken(uint256 battleId) external view returns (address) {
        return _battleToken[manager][battleId];
    }

    /// @inheritdoc IRewardVault
    function battleBalance(uint256 battleId) external view returns (uint256) {
        return _battleBalance[manager][battleId];
    }

    /// @notice Explicit accessor for a specific manager's battle data — e.g. to inspect what a
    /// superseded BattleManager (before a redeploy) left behind.
    function battleTokenFor(address manager_, uint256 battleId) external view returns (address) {
        return _battleToken[manager_][battleId];
    }

    /// @notice See `battleTokenFor`.
    function battleBalanceFor(address manager_, uint256 battleId) external view returns (uint256) {
        return _battleBalance[manager_][battleId];
    }

    function _send(address token, address to, uint256 amount) internal {
        if (token == address(0)) {
            (bool ok,) = to.call{ value: amount }("");
            if (!ok) revert NativeTransferFailed();
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }

    receive() external payable { }
}
