# BridgeSureEscrow Contract Specification

Status: ready. Date: 2026-08-06 (Phase 3).

Defines the ABI-level contract surface, events, custom errors, and the concrete EIP-712
authorization encoding that Phase 4 must implement. This is the authoritative contract reference;
docs/engineering/technical-design.md section 7-8 provides the rationale.

## 1. Interfaces

```solidity
// OpenZeppelin
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

// Cleanverse CVI validator (single-contract pattern)
interface IAPassComplianceValidator {
    function complianceVerify(address pool, address user) external view returns (bool);
}

// CVA policy hook (independent second gate; the A-Token's internal _update invokes it)
interface IATokenPolicy {
    function canTransfer(address token, address from, address to, uint256 amount)
        external view returns (bool);
}
```

The validator address is stored immutably. The escrow is registered as its own validator pool
(Phase 5) and calls `complianceVerify(address(this), participant)` inside value-moving logic.

## 2. Constructor

```solidity
constructor(
    address cvaToken,          // configured CVA/A-Token (aUSDC on Monad Testnet)
    address validator_,        // IAPassComplianceValidator (immutable)
    address importer,
    address exporter,
    address admin_,            // owner; cannot bypass release authorization
    address releaseSigner_,    // trusted EIP-712 authorization signer
    bytes32 tradeId,           // bound by authorization
    uint256 milestoneOneAmount,
    uint256 milestoneTwoAmount,
    uint256 authorizationExpiryWindow, // e.g. seconds; server also enforces short expiry
    uint256 holdDuration        // 0 = no timed hold
)
```

Reverts on zero addresses, zero amounts, or if `milestoneOneAmount + milestoneTwoAmount` overflows.

## 3. State

```solidity
// Token and validator
address public immutable cvaToken;
address public immutable validator;

// Parties
address public immutable importer;
address public immutable exporter;
address public immutable admin;
address public immutable releaseSigner;

// Trade
bytes32 public immutable tradeId;
uint256 public immutable milestoneOneAmount;
uint256 public immutable milestoneTwoAmount;
uint256 public immutable authorizationExpiryWindow;

// Accounting
uint256 public fundedAmount;      // total CVA received
uint256 public releasedAmount;    // cumulative released
bool   public funded;

// Milestones
mapping(uint256 => bool) public milestoneReleased;   // index 1 and 2
mapping(uint256 => bool) public milestoneBlocked;

// Authorization replay protection
mapping(bytes32 => bool) public usedNonces;          // keccak256(chainId, escrow, tradeId, milestoneId, signer, nonce) -> consumed

// Hold / refund
bool public held;
uint256 public holdDeadline;
address public holdRequester;                          // admin
```

All state reads are `public` for the UI/audit layer. Nothing is upgradeable.

## 4. Methods

```solidity
// Funding — CVA-only transferFrom; idempotent while unfunded
function fund(uint256 amount) external nonReentrant;

// Release — verifies authorization, then direct validator checks, then transfers
function releaseMilestone(
    ReleaseAuthorization calldata auth,
    bytes calldata signature
) external nonReentrant returns (bool);

// Hold — admin only, emits event; requires authorization context
function enterHold(bytes32 reasonHash) external onlyAdmin;

// Refund — fresh-check path; admin-signed authorization required
function refund(
    ReleaseAuthorization calldata auth,
    bytes calldata signature
) external nonReentrant onlyAdmin;

// View
function getTradeState()
    external view returns (
        TradeStatus status,
        uint256 funded,
        uint256 released,
        bool milestoneOneReleased,
        bool milestoneTwoReleased,
        bool held,
        uint256 holdDeadline_
    );
```

Release flow (order matters, checks-effects-interactions):

1. `_verifyAuthorization(auth, signature)` — EIP-712: domain, signer == releaseSigner, all
   fields, `auth.expiry >= block.timestamp`, `usedNonces[...] == false`.
2. Mark the nonce consumed (effect).
3. Current milestone must be pending and sequential (`auth.milestoneId` is 1 then 2).
4. `auth.amount` must equal the milestone's configured amount; `releasedAmount + amount <=
fundedAmount`.
5. Direct validator gate: `IAPassComplianceValidator(validator).complianceVerify(address(this),
importer)` and same for `exporter` — both must return true; revert on revert.
6. Optional CVA policy gate: `IATokenPolicy.canTransfer(cvaToken, address(this), exporter,
amount)`.
7. `SafeERC20.safeTransfer(cvaToken, exporter, amount)`; increment accounting; emit event.

A revert, paused pool, or false result at any step reverts the whole transaction — no partial
state change.

## 5. EIP-712 Authorization

Domain:

```solidity
EIP712Domain(string name, string version, uint256 chainId, address verifyingContract)
name    = "BridgeSure"
version = "1"
chainId = 10143 (Monad Testnet; runtime value)
verifyingContract = address(this)
```

Struct:

```solidity
struct ReleaseAuthorization {
    bytes32 tradeId;        // trade the release belongs to
    uint256 milestoneId;    // 1 or 2
    address importer;       // bound party
    address exporter;       // bound party
    address token;          // must equal cvaToken
    uint256 amount;         // must equal milestone amount
    uint256 nonce;          // single-use
    uint256 expiry;         // Unix seconds; server enforces short window
    bytes32 evidenceDigest; // hash of fresh compliance evidence (server-side)
}
```

Typehashes (encode exactly; the server signs the same strings):

```text
EIP712_DOMAIN_TYPEHASH =
    keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")

RELEASE_AUTHORIZATION_TYPEHASH =
    keccak256("ReleaseAuthorization(bytes32 tradeId,uint256 milestoneId,address importer,address exporter,address token,uint256 amount,uint256 nonce,uint256 expiry,bytes32 evidenceDigest)")

domainSeparator =
    keccak256(abi.encode(EIP712_DOMAIN_TYPEHASH, keccak256("BridgeSure"), keccak256("1"), chainId, address(this)))

digest = keccak256(abi.encodePacked(
    "\x19\x01",
    domainSeparator,
    keccak256(abi.encode(
        RELEASE_AUTHORIZATION_TYPEHASH,
        tradeId, milestoneId, importer, exporter, token, amount, nonce, expiry, evidenceDigest
    ))
))
```

Verify with `ECDSA.recover(digest, signature) == releaseSigner`.

## 6. Events

```solidity
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
```

## 7. Custom Errors

```solidity
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
error WrongParty();
```

Every error is revertible and carries no sensitive data.

## 8. Rule-management wrappers (conditional)

Added only if the deployed validator expects the registered pool to invoke
`setRuleV2FromContract` / `addRuleV2FromContract` (owner- or narrow-compliance-admin guarded). The
Phase 5 `validator/register` path already sets the initial rule via the API, so these wrappers are
expected to be unnecessary for the MVP.

## 9. Implementation notes

- Custom errors, CEI, SafeERC20, explicit events, least-privilege roles, reentrancy guard on
  value-moving entry points. No upgradeability.
- `auth.token`, `auth.amount`, and parties are always re-verified against immutables — never trust
  the caller's struct beyond what the signature binds.
- Keep the server and contract on the same typehash strings; add a Solidity test that asserts the
  expected `RELEASE_AUTHORIZATION_TYPEHASH` constant matches the server's signing output.
