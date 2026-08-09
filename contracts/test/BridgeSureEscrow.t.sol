// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Test} from "forge-std/Test.sol";
import {IAPassComplianceValidator, IATokenPolicy, BridgeSureEscrow} from "../src/BridgeSureEscrow.sol";

/// @notice Minimal ERC20 standing in for the CVA A-Token (aUSDC) in tests.
///         Also implements the optional CVA policy hook so the escrow's
///         `IATokenPolicy(cvaToken)` gate can be exercised.
contract MockAToken is ERC20, IATokenPolicy {
    bool public allowTransfer = true;

    constructor() ERC20("Mock aUSDC", "aUSDC") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setAllowTransfer(bool ok) external {
        allowTransfer = ok;
    }

    function canTransfer(address, address, address, uint256) external view returns (bool) {
        return allowTransfer;
    }
}

/// @notice Deterministic CVI validator mock. `valid` gates both participants;
///         `revertOnCall` simulates an unregistered/paused pool (PoolNotRegistered).
///         `registerApass` records the pool's CVA-vault registration.
contract MockValidator is IAPassComplianceValidator {
    mapping(address => bool) public eligible;
    mapping(address => bool) public registered;
    mapping(address => address) public boundAToken; // pool -> registered aToken
    bool public revertOnCall;

    function setEligible(address user, bool ok) external {
        eligible[user] = ok;
    }

    function setRevertOnCall(bool on) external {
        revertOnCall = on;
    }

    function complianceVerify(address, address user) external view returns (bool) {
        if (revertOnCall) revert("PoolNotRegistered()");
        return eligible[user];
    }

    function registerApass(address poolAddress, address aTokenAddress) external {
        registered[poolAddress] = true;
        boundAToken[poolAddress] = aTokenAddress;
    }
}

/// @notice Shared test harness: deploys the escrow and gives the harness the
///         EIP-712 signing capability of the trusted release signer.
abstract contract EscrowTestBase is Test {
    MockAToken public cva;
    MockValidator public validator;
    BridgeSureEscrow public escrow;

    address public importer;
    address public exporter;
    address public admin;
    address public releaseSigner;
    bytes32 public tradeId;
    uint256 public milestoneOneAmount = 400e6; // 400 aUSDC (6 decimals)
    uint256 public milestoneTwoAmount = 600e6;

    uint256 internal signerKey;

    function setUp() public virtual {
        cva = new MockAToken();
        validator = new MockValidator();

        importer = makeAddr("importer");
        exporter = makeAddr("exporter");
        admin = makeAddr("admin");
        (releaseSigner, signerKey) = makeAddrAndKey("releaseSigner");
        tradeId = keccak256("trade-1");

        escrow = new BridgeSureEscrow(
            address(cva),
            address(validator),
            importer,
            exporter,
            admin,
            releaseSigner,
            tradeId,
            milestoneOneAmount,
            milestoneTwoAmount,
            600, // authorizationExpiryWindow seconds
            0 // holdDuration
        );

        cva.mint(importer, 1_000e6);
        vm.prank(importer);
        cva.approve(address(escrow), type(uint256).max);

        validator.setEligible(importer, true);
        validator.setEligible(exporter, true);
    }

    function _fund() internal {
        vm.prank(importer);
        escrow.fund(milestoneOneAmount + milestoneTwoAmount);
    }

    function _signAuth(
        uint256 milestoneId,
        address token,
        uint256 amount,
        uint256 nonce,
        uint256 expiry,
        bytes32 evidenceDigest
    ) internal returns (BridgeSureEscrow.ReleaseAuthorization memory auth, bytes memory signature) {
        auth = BridgeSureEscrow.ReleaseAuthorization({
            tradeId: tradeId,
            milestoneId: milestoneId,
            importer: importer,
            exporter: exporter,
            token: token,
            amount: amount,
            nonce: nonce,
            expiry: expiry,
            evidenceDigest: evidenceDigest
        });

        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                keccak256(
                    abi.encode(
                        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                        keccak256("BridgeSure"),
                        keccak256("1"),
                        block.chainid,
                        address(escrow)
                    )
                ),
                keccak256(
                    abi.encode(
                        keccak256(
                            "ReleaseAuthorization(bytes32 tradeId,uint256 milestoneId,address importer,address exporter,address token,uint256 amount,uint256 nonce,uint256 expiry,bytes32 evidenceDigest)"
                        ),
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
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, digest);
        signature = abi.encodePacked(r, s, v);
    }

    function _freshAuth(uint256 milestoneId, uint256 nonce)
        internal
        returns (BridgeSureEscrow.ReleaseAuthorization memory auth, bytes memory signature)
    {
        return _signAuth(
            milestoneId,
            address(cva),
            milestoneId == 1 ? milestoneOneAmount : milestoneTwoAmount,
            nonce,
            block.timestamp + 300,
            keccak256("evidence")
        );
    }
}

contract BridgeSureEscrowTest is EscrowTestBase {
    function test_SuccessfulMilestoneOneRelease() public {
        _fund();
        (BridgeSureEscrow.ReleaseAuthorization memory auth, bytes memory sig) = _freshAuth(1, 1);

        vm.expectEmit(true, true, true, true, address(escrow));
        emit BridgeSureEscrow.MilestoneReleased(tradeId, 1, exporter, milestoneOneAmount, auth.evidenceDigest, 1);
        assertTrue(escrow.releaseMilestone(auth, sig));

        assertEq(cva.balanceOf(exporter), milestoneOneAmount);
        assertEq(cva.balanceOf(address(escrow)), milestoneTwoAmount);
        assertEq(escrow.releasedAmount(), milestoneOneAmount);
        assertTrue(escrow.milestoneReleased(1));

        (BridgeSureEscrow.TradeStatus status,,,,,,) = escrow.getTradeState();
        assertEq(uint256(status), uint256(BridgeSureEscrow.TradeStatus.ACTIVE));
    }

    function test_SecondReleaseAfterFirst() public {
        _fund();
        (BridgeSureEscrow.ReleaseAuthorization memory a1, bytes memory s1) = _freshAuth(1, 1);
        escrow.releaseMilestone(a1, s1);
        (BridgeSureEscrow.ReleaseAuthorization memory a2, bytes memory s2) = _freshAuth(2, 2);
        escrow.releaseMilestone(a2, s2);

        assertEq(cva.balanceOf(exporter), milestoneOneAmount + milestoneTwoAmount);
        assertEq(cva.balanceOf(address(escrow)), 0);
        assertTrue(escrow.milestoneReleased(2));
    }

    function test_FrozenParticipantBlocksMilestoneTwo_UnchangedBalances() public {
        _fund();
        (BridgeSureEscrow.ReleaseAuthorization memory a1, bytes memory s1) = _freshAuth(1, 1);
        escrow.releaseMilestone(a1, s1);

        uint256 escrowBefore = cva.balanceOf(address(escrow));
        uint256 exporterBefore = cva.balanceOf(exporter);

        // Exporter invalidated (A-Pass frozen).
        validator.setEligible(exporter, false);

        (BridgeSureEscrow.ReleaseAuthorization memory a2, bytes memory s2) = _freshAuth(2, 2);
        vm.expectRevert(abi.encodeWithSelector(BridgeSureEscrow.ComplianceCheckFailed.selector, exporter));
        escrow.releaseMilestone(a2, s2);

        assertEq(cva.balanceOf(address(escrow)), escrowBefore);
        assertEq(cva.balanceOf(exporter), exporterBefore);
        assertFalse(escrow.milestoneReleased(2));
        assertEq(escrow.releasedAmount(), milestoneOneAmount);
    }

    function test_PausedValidatorFailsClosed() public {
        _fund();
        validator.setRevertOnCall(true);

        (BridgeSureEscrow.ReleaseAuthorization memory auth, bytes memory sig) = _freshAuth(1, 1);
        vm.expectRevert(BridgeSureEscrow.ValidatorReverted.selector);
        escrow.releaseMilestone(auth, sig);

        assertEq(cva.balanceOf(exporter), 0);
        assertEq(cva.balanceOf(address(escrow)), milestoneOneAmount + milestoneTwoAmount);
    }

    function test_CvaPolicyRejected() public {
        _fund();
        cva.setAllowTransfer(false);

        (BridgeSureEscrow.ReleaseAuthorization memory auth, bytes memory sig) = _freshAuth(1, 1);
        vm.expectRevert(BridgeSureEscrow.CvaTransferRejected.selector);
        escrow.releaseMilestone(auth, sig);
    }

    function test_WrongSignerReverts() public {
        _fund();
        (BridgeSureEscrow.ReleaseAuthorization memory auth,) = _freshAuth(1, 1);
        bytes memory badSig = abi.encodePacked(hex"00", hex"00", uint8(27));
        vm.expectRevert();
        escrow.releaseMilestone(auth, badSig);
    }

    function test_WrongTradeReverts() public {
        _fund();
        (BridgeSureEscrow.ReleaseAuthorization memory auth, bytes memory sig) =
            _signAuth(1, address(cva), milestoneOneAmount, 1, block.timestamp + 300, keccak256("ev"));
        auth.tradeId = keccak256("other-trade");
        vm.expectRevert(BridgeSureEscrow.WrongTrade.selector);
        escrow.releaseMilestone(auth, sig);
    }

    function test_WrongMilestoneReverts() public {
        _fund();
        (BridgeSureEscrow.ReleaseAuthorization memory auth, bytes memory sig) = _freshAuth(1, 1);
        // Milestone 1 already released.
        escrow.releaseMilestone(auth, sig);
        // Try milestone 1 again -> AlreadyReleased.
        (BridgeSureEscrow.ReleaseAuthorization memory a2, bytes memory s2) = _freshAuth(1, 2);
        vm.expectRevert(BridgeSureEscrow.MilestoneAlreadyReleased.selector);
        escrow.releaseMilestone(a2, s2);
    }

    function test_OutOfSequenceMilestoneTwoReverts() public {
        _fund();
        (BridgeSureEscrow.ReleaseAuthorization memory auth, bytes memory sig) = _freshAuth(2, 1);
        vm.expectRevert(BridgeSureEscrow.MilestoneOutOfSequence.selector);
        escrow.releaseMilestone(auth, sig);
    }

    function test_WrongTokenReverts() public {
        _fund();
        (BridgeSureEscrow.ReleaseAuthorization memory auth, bytes memory sig) =
            _signAuth(1, makeAddr("otherToken"), milestoneOneAmount, 1, block.timestamp + 300, keccak256("ev"));
        vm.expectRevert(BridgeSureEscrow.WrongToken.selector);
        escrow.releaseMilestone(auth, sig);
    }

    function test_WrongAmountReverts() public {
        _fund();
        (BridgeSureEscrow.ReleaseAuthorization memory auth, bytes memory sig) =
            _signAuth(1, address(cva), milestoneOneAmount - 1, 1, block.timestamp + 300, keccak256("ev"));
        vm.expectRevert(BridgeSureEscrow.WrongAmount.selector);
        escrow.releaseMilestone(auth, sig);
    }

    function test_ExpiredAuthorizationReverts() public {
        _fund();
        (BridgeSureEscrow.ReleaseAuthorization memory auth, bytes memory sig) =
            _signAuth(1, address(cva), milestoneOneAmount, 1, block.timestamp - 1, keccak256("ev"));
        vm.expectRevert(BridgeSureEscrow.AuthorizationExpired.selector);
        escrow.releaseMilestone(auth, sig);
    }

    function test_NonceReplayReverts() public {
        _fund();
        (BridgeSureEscrow.ReleaseAuthorization memory auth, bytes memory sig) = _freshAuth(1, 1);
        escrow.releaseMilestone(auth, sig);
        vm.expectRevert(BridgeSureEscrow.AuthorizationReplay.selector);
        escrow.releaseMilestone(auth, sig);
    }

    function test_FundBeforeRelease() public {
        (BridgeSureEscrow.ReleaseAuthorization memory auth, bytes memory sig) = _freshAuth(1, 1);
        vm.expectRevert(BridgeSureEscrow.TradeNotFunded.selector);
        escrow.releaseMilestone(auth, sig);
    }

    function test_OnlyImporterCanFund() public {
        vm.prank(exporter);
        vm.expectRevert(BridgeSureEscrow.WrongParty.selector);
        escrow.fund(milestoneOneAmount + milestoneTwoAmount);
    }

    function test_OnlyAdminCanHoldAndRefund() public {
        vm.prank(exporter);
        vm.expectRevert(BridgeSureEscrow.OnlyAdmin.selector);
        escrow.enterHold(keccak256("reason"));

        _fund();
        (BridgeSureEscrow.ReleaseAuthorization memory auth, bytes memory sig) = _freshAuth(1, 1);
        vm.prank(exporter);
        vm.expectRevert(BridgeSureEscrow.OnlyAdmin.selector);
        escrow.refund(auth, sig);
    }

    function test_HoldAndRefund() public {
        _fund();
        vm.prank(admin);
        escrow.enterHold(keccak256("reason"));

        (BridgeSureEscrow.TradeStatus status,,,,, bool held_,) = escrow.getTradeState();
        assertEq(uint256(status), uint256(BridgeSureEscrow.TradeStatus.HOLD));
        assertTrue(held_);
        // Refund with a milestoneId=0 authorization signed by the release signer.
        (BridgeSureEscrow.ReleaseAuthorization memory auth, bytes memory sig) =
            _signAuth(0, address(cva), 0, 5, block.timestamp + 300, keccak256("refund"));
        vm.prank(admin);
        escrow.refund(auth, sig);

        assertEq(cva.balanceOf(importer), 1_000e6); // full refund back
        assertEq(cva.balanceOf(address(escrow)), 0);
        assertFalse(escrow.funded());
    }

    function test_OwnerReturnsAdmin() public view {
        // The validator gateway verifies pool-registration owner signatures
        // against owner() of the subject contract (AGENTS.md / validator docs).
        assertEq(escrow.owner(), admin);
    }

    function test_AdminRegistersPoolAsVault() public {
        assertFalse(validator.registered(address(escrow)));
        vm.prank(admin);
        escrow.registerPool();
        assertTrue(validator.registered(address(escrow)));
        // The escrow must bind the configured CVA token, not a wrong one.
        assertEq(validator.boundAToken(address(escrow)), address(cva));
    }

    function test_OnlyAdminCanRegisterPool() public {
        vm.prank(exporter);
        vm.expectRevert(BridgeSureEscrow.OnlyAdmin.selector);
        escrow.registerPool();
    }

    function test_FundingOnlyOnce() public {
        _fund();
        vm.prank(importer);
        vm.expectRevert(BridgeSureEscrow.TradeNotFunded.selector);
        escrow.fund(1);
    }

    function test_ReleaseAuthorizationTypehashMatchesSpec() public {
        // Spec (docs/planning/contract-spec.md §5): the server signs the same
        // typehash string. Assert the exact keccak256 the API layer must use.
        bytes32 expected = keccak256(
            "ReleaseAuthorization(bytes32 tradeId,uint256 milestoneId,address importer,address exporter,address token,uint256 amount,uint256 nonce,uint256 expiry,bytes32 evidenceDigest)"
        );
        assertEq(expected, 0xab7f55c95308a553d3a99b41922dfa698e879483d36fd45a21368e823d62cb56);
    }

    /// Malicious token tries to reenter releaseMilestone during the transfer.
    function test_ReentrancyBlocked() public {
        ReentrantToken rt = new ReentrantToken(escrow);

        // Fund with the malicious token: importer mints + approves.
        rt.mint(importer, 1_000e6);
        vm.prank(importer);
        rt.approve(address(escrow), type(uint256).max);
        vm.prank(importer);
        escrow.fund(1_000e6);

        // Two valid authorizations: nonce 1 for the outer call, nonce 2 for the
        // reentrant call. The reentrant call would pass auth verification, so
        // only the reentrancy guard can stop it.
        (BridgeSureEscrow.ReleaseAuthorization memory outer, bytes memory outerSig) =
            _signAuth(1, address(rt), 400e6, 1, block.timestamp + 300, keccak256("ev"));
        (BridgeSureEscrow.ReleaseAuthorization memory inner, bytes memory innerSig) =
            _signAuth(1, address(rt), 400e6, 2, block.timestamp + 300, keccak256("ev"));
        rt.setReenterData(inner, innerSig);

        vm.expectRevert();
        escrow.releaseMilestone(outer, outerSig);
    }
}

/// @notice Token whose transfer() reenters releaseMilestone on the escrow with a
///         valid, unconsumed authorization — only the guard should reject it.
contract ReentrantToken is ERC20, IATokenPolicy {
    BridgeSureEscrow public immutable escrow;
    BridgeSureEscrow.ReleaseAuthorization public reenterAuth;
    bytes public reenterSig;

    constructor(BridgeSureEscrow escrow_) ERC20("Reentrant", "RENT") {
        escrow = escrow_;
    }

    function setReenterData(BridgeSureEscrow.ReleaseAuthorization calldata auth, bytes calldata sig) external {
        reenterAuth = auth;
        reenterSig = sig;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function canTransfer(address, address, address, uint256) external pure returns (bool) {
        return true;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        bool ok = super.transfer(to, amount);
        if (reenterSig.length > 0) {
            escrow.releaseMilestone(reenterAuth, reenterSig);
        }
        return ok;
    }
}
