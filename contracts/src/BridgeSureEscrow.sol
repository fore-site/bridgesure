// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @notice Cleanverse CVI compliance validator (single-contract pattern).
///         Registered as the escrow's own pool; reverts
///         `PoolNotRegistered()` when the pool is not registered.
interface IAPassComplianceValidator {
    function complianceVerify(address pool, address user) external view returns (bool);
}

/// @notice CVA policy hook (independent second gate; the A-Token's internal
///         _update invokes it). Optional, not a replacement for the release gate.
interface IATokenPolicy {
    function canTransfer(address token, address from, address to, uint256 amount) external view returns (bool);
}

/// @title BridgeSureEscrow
/// @notice Compliance-continuous escrow for a single two-milestone trade on Monad.
///         Funded with a configured CVA A-Token; releases require a server-signed
///         EIP-712 authorization and direct CVI validator checks immediately before
///         the token transfer. Any revert, paused pool, or false result fails closed.
contract BridgeSureEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------
    // Custom errors
    // ---------------------------------------------------------------------

    error UnauthorizedSigner();
    error AuthorizationExpired();
    error AuthorizationReplay();
    error WrongTrade();
    error WrongMilestone();
    error WrongToken();
    error WrongAmount();
    error WrongParty();
    error TradeNotFunded();
    error MilestoneAlreadyReleased();
    error MilestoneOutOfSequence();
    error InsufficientFunds();
    error ComplianceCheckFailed(address participant);
    error ValidatorReverted();
    error CvaTransferRejected();
    error HoldActive();
    error RefundNotAllowed();
    error ZeroAddress();
    error ZeroAmount();
    error OnlyAdmin();

    // ---------------------------------------------------------------------
    // EIP-712
    // ---------------------------------------------------------------------

    bytes32 internal constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    bytes32 internal constant RELEASE_AUTHORIZATION_TYPEHASH = keccak256(
        "ReleaseAuthorization(bytes32 tradeId,uint256 milestoneId,address importer,address exporter,address token,uint256 amount,uint256 nonce,uint256 expiry,bytes32 evidenceDigest)"
    );

    bytes32 internal constant NAME_HASH = keccak256("BridgeSure");
    bytes32 internal constant VERSION_HASH = keccak256("1");

    // ---------------------------------------------------------------------
    // State (immutables + storage, nothing upgradeable)
    // ---------------------------------------------------------------------

    address public immutable cvaToken;
    address public immutable validator;
    address public immutable importer;
    address public immutable exporter;
    address public immutable admin;
    address public immutable releaseSigner;
    bytes32 public immutable tradeId;
    uint256 public immutable milestoneOneAmount;
    uint256 public immutable milestoneTwoAmount;
    uint256 public immutable authorizationExpiryWindow;

    uint256 public fundedAmount;
    uint256 public releasedAmount;
    bool public funded;

    mapping(uint256 => bool) public milestoneReleased; // index 1 and 2
    mapping(uint256 => bool) public milestoneBlocked;

    /// keccak256(chainId, escrow, tradeId, milestoneId, signer, nonce) -> consumed
    mapping(bytes32 => bool) public usedNonces;

    bool public held;
    uint256 public holdDeadline;
    address public holdRequester;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event Funded(address indexed from, uint256 amount, bytes32 tradeId);
    event MilestoneReleased(
        bytes32 indexed tradeId,
        uint256 indexed milestoneId,
        address indexed recipient,
        uint256 amount,
        bytes32 evidenceDigest,
        uint256 nonce
    );
    event MilestoneBlocked(bytes32 indexed tradeId, uint256 indexed milestoneId, bytes32 reasonHash);
    event Held(bytes32 indexed tradeId, bytes32 reasonHash, uint256 holdDeadline);
    event Refunded(bytes32 indexed tradeId, address indexed recipient, uint256 amount, uint256 nonce);
    event AuthorizationNonceConsumed(address indexed signer, uint256 nonce);

    enum TradeStatus {
        DRAFT,
        FUNDED,
        ACTIVE,
        COMPLETE,
        HOLD,
        REFUNDED
    }

    struct ReleaseAuthorization {
        bytes32 tradeId;
        uint256 milestoneId;
        address importer;
        address exporter;
        address token;
        uint256 amount;
        uint256 nonce;
        uint256 expiry;
        bytes32 evidenceDigest;
    }

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    constructor(
        address cvaToken_,
        address validator_,
        address importer_,
        address exporter_,
        address admin_,
        address releaseSigner_,
        bytes32 tradeId_,
        uint256 milestoneOneAmount_,
        uint256 milestoneTwoAmount_,
        uint256 authorizationExpiryWindow_,
        uint256 holdDuration
    ) {
        if (cvaToken_ == address(0)) revert ZeroAddress();
        if (validator_ == address(0)) revert ZeroAddress();
        if (importer_ == address(0)) revert ZeroAddress();
        if (exporter_ == address(0)) revert ZeroAddress();
        if (admin_ == address(0)) revert ZeroAddress();
        if (releaseSigner_ == address(0)) revert ZeroAddress();
        if (milestoneOneAmount_ == 0) revert ZeroAmount();
        if (milestoneTwoAmount_ == 0) revert ZeroAmount();

        cvaToken = cvaToken_;
        validator = validator_;
        importer = importer_;
        exporter = exporter_;
        admin = admin_;
        releaseSigner = releaseSigner_;
        tradeId = tradeId_;
        milestoneOneAmount = milestoneOneAmount_;
        milestoneTwoAmount = milestoneTwoAmount_;
        authorizationExpiryWindow = authorizationExpiryWindow_;

        if (holdDuration > 0) {
            held = true;
            holdDeadline = block.timestamp + holdDuration;
            holdRequester = admin_;
        }
    }

    // ---------------------------------------------------------------------
    // Funding — CVA-only transferFrom; idempotent while unfunded
    // ---------------------------------------------------------------------

    function fund(uint256 amount) external nonReentrant {
        if (funded) revert TradeNotFunded(); // already funded
        if (amount == 0) revert ZeroAmount();
        if (msg.sender != importer) revert WrongParty();

        IERC20(cvaToken).safeTransferFrom(msg.sender, address(this), amount);
        fundedAmount = amount;
        funded = true;
        emit Funded(msg.sender, amount, tradeId);
    }

    // ---------------------------------------------------------------------
    // Release — verify authorization, then direct validator checks, then transfer
    // ---------------------------------------------------------------------

    function releaseMilestone(ReleaseAuthorization calldata auth, bytes calldata signature)
        external
        nonReentrant
        returns (bool)
    {
        _verifyAuthorization(auth, signature, true);

        // Current milestone must be pending and sequential (1 then 2).
        if (auth.milestoneId != 1 && auth.milestoneId != 2) revert WrongMilestone();
        if (milestoneReleased[auth.milestoneId]) revert MilestoneAlreadyReleased();
        if (auth.milestoneId == 2 && !milestoneReleased[1]) revert MilestoneOutOfSequence();

        if (!funded) revert TradeNotFunded();
        if (auth.amount != _milestoneAmount(auth.milestoneId)) revert WrongAmount();
        if (releasedAmount + auth.amount > fundedAmount) revert InsufficientFunds();

        // Direct validator gate immediately before effects and transfer.
        _verifyCompliance(importer);
        _verifyCompliance(exporter);

        // Optional CVA policy gate (independent second check).
        IATokenPolicy policy = IATokenPolicy(cvaToken);
        (bool okPolicy,) = address(policy)
            .staticcall(
                abi.encodeWithSelector(
                    IATokenPolicy.canTransfer.selector, cvaToken, address(this), exporter, auth.amount
                )
            );
        if (okPolicy && !policy.canTransfer(cvaToken, address(this), exporter, auth.amount)) {
            revert CvaTransferRejected();
        }

        // Effects then interactions.
        milestoneReleased[auth.milestoneId] = true;
        releasedAmount += auth.amount;
        IERC20(cvaToken).safeTransfer(exporter, auth.amount);
        emit MilestoneReleased(tradeId, auth.milestoneId, exporter, auth.amount, auth.evidenceDigest, auth.nonce);
        return true;
    }

    // ---------------------------------------------------------------------
    // Hold / refund
    // ---------------------------------------------------------------------

    function enterHold(bytes32 reasonHash) external onlyAdmin {
        if (funded && releasedAmount == fundedAmount) revert RefundNotAllowed();
        held = true;
        holdDeadline = 0;
        holdRequester = msg.sender;
        emit Held(tradeId, reasonHash, holdDeadline);
    }

    function refund(ReleaseAuthorization calldata auth, bytes calldata signature) external nonReentrant onlyAdmin {
        if (auth.milestoneId != 0) revert WrongMilestone();
        if (!funded) revert TradeNotFunded();
        _verifyAuthorization(auth, signature, false);

        // Refund returns the full funded amount to the importer.
        uint256 amount = fundedAmount - releasedAmount;
        if (amount == 0) revert RefundNotAllowed();

        fundedAmount = 0;
        funded = false;
        IERC20(cvaToken).safeTransfer(importer, amount);
        emit Refunded(tradeId, importer, amount, auth.nonce);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getTradeState()
        external
        view
        returns (
            TradeStatus status,
            uint256 funded_,
            uint256 released_,
            bool milestoneOneReleased_,
            bool milestoneTwoReleased_,
            bool held_,
            uint256 holdDeadline_
        )
    {
        if (funded && releasedAmount == fundedAmount) {
            status = TradeStatus.COMPLETE;
        } else if (held) {
            status = TradeStatus.HOLD;
        } else if (releasedAmount > 0) {
            status = TradeStatus.ACTIVE;
        } else if (funded) {
            status = TradeStatus.FUNDED;
        } else {
            status = TradeStatus.DRAFT;
        }
        return (status, fundedAmount, releasedAmount, milestoneReleased[1], milestoneReleased[2], held, holdDeadline);
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparator();
    }

    function digestFor(ReleaseAuthorization calldata auth) external view returns (bytes32) {
        return _digest(auth);
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    function _verifyAuthorization(ReleaseAuthorization calldata auth, bytes calldata signature, bool requireMilestone)
        internal
    {
        bytes32 nonceKey =
            keccak256(abi.encode(block.chainid, address(this), tradeId, auth.milestoneId, releaseSigner, auth.nonce));
        if (usedNonces[nonceKey]) revert AuthorizationReplay();
        if (auth.expiry < block.timestamp) revert AuthorizationExpired();
        if (auth.tradeId != tradeId) revert WrongTrade();
        if (auth.importer != importer || auth.exporter != exporter) revert WrongParty();
        if (auth.token != cvaToken) revert WrongToken();
        if (requireMilestone && (auth.milestoneId != 1 && auth.milestoneId != 2)) revert WrongMilestone();

        bytes32 digest = _digest(auth);
        address recovered = ECDSA.recover(digest, signature);
        if (recovered != releaseSigner) revert UnauthorizedSigner();

        // Mark the nonce consumed (effect before interactions).
        usedNonces[nonceKey] = true;
        emit AuthorizationNonceConsumed(releaseSigner, auth.nonce);
    }

    function _digest(ReleaseAuthorization calldata auth) internal view returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                "\x19\x01",
                _domainSeparator(),
                keccak256(
                    abi.encode(
                        RELEASE_AUTHORIZATION_TYPEHASH,
                        auth.tradeId,
                        auth.milestoneId,
                        auth.importer,
                        auth.exporter,
                        auth.token,
                        auth.amount,
                        auth.nonce,
                        auth.expiry,
                        auth.evidenceDigest
                    )
                )
            )
        );
    }

    function _domainSeparator() internal view returns (bytes32) {
        return keccak256(abi.encode(EIP712_DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this)));
    }

    function _milestoneAmount(uint256 milestoneId) internal view returns (uint256) {
        return milestoneId == 1 ? milestoneOneAmount : milestoneTwoAmount;
    }

    function _verifyCompliance(address participant) internal view {
        (bool ok,) = validator.staticcall(
            abi.encodeWithSelector(IAPassComplianceValidator.complianceVerify.selector, address(this), participant)
        );
        if (!ok) revert ValidatorReverted();
        bool valid = IAPassComplianceValidator(validator).complianceVerify(address(this), participant);
        if (!valid) revert ComplianceCheckFailed(participant);
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) revert OnlyAdmin();
        _;
    }
}
