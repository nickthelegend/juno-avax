// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";
import {CurveMath} from "./CurveMath.sol";

/// @title One Juno post: its coin, opening auction, curve, floor and dare.
/// @notice Every post is its own ERC-20 (0 decimals, 1,000 at most):
///  1. Sealed-bid opening auction (60 s of commits, 60 s of reveals). Every
///     bid escrows exactly BID_ESCROW, so the deposit says nothing about the
///     bid. Settlement fills the 200 auction tokens highest price first and
///     charges every winner the same clearing price (the lowest filled bid).
///  2. Bonding curve for the other 800 tokens (CurveMath). A buy pays the
///     curve price (or the floor, if that is higher) + 20% into the floor
///     vault + a 1% fee shared by the creator and the graduation escrow.
///  3. Redeemable floor: any holder burns tokens for 99% of their pro-rata
///     share of the vault. The 1% left behind raises the floor for the rest.
///  4. Graduation: when the curve sells out, the curve reserve and the
///     graduation escrow move into the floor vault and the curve closes, so
///     every remaining token redeems against everything the post raised.
///  5. Dare bond: the creator stakes AVAX on a promise, posts proof, holders
///     vote weighted by balance; a failed or missing proof sends the bond
///     into the floor vault for the holders.
/// Payouts that can be pulled are pulled (refunds, earnings); sells and
/// redemptions pay out last, after all state is written, under a reentrancy guard.
contract JunoPost is ERC20, ReentrancyGuard {
    uint256 public constant AUCTION_UNITS = 200;
    uint256 public constant CURVE_UNITS = 800;
    uint256 public constant BID_ESCROW = 0.005 ether;
    uint256 public constant COMMIT_SECONDS = 60;
    uint256 public constant REVEAL_SECONDS = 60;
    uint256 public constant DARE_SECONDS = 300;
    uint256 public constant MAX_BIDS = 64;
    uint256 public constant MAX_VOTERS = 64;
    uint256 public constant MAX_TRADES = 120;

    enum Phase {
        Commit,
        Reveal,
        Settle,
        Curve,
        Graduated
    }

    enum Kind {
        Auction,
        Buy,
        Sell,
        Redeem
    }

    struct Bid {
        address owner;
        bool revealed;
        uint16 amount;
        uint16 allocated;
        uint128 maxPrice;
        bytes32 commitment;
        uint256 refund;
    }

    /// @dev Two storage slots per fill, kept so a client can draw charts without an indexer.
    struct Trade {
        uint40 time;
        Kind kind;
        address account;
        uint16 quantity;
        uint16 soldAfter;
        uint128 total;
    }

    struct MarketView {
        address post;
        string slug;
        address creator;
        string caption;
        string mediaUrl;
        Phase phase;
        uint64 openedAt;
        uint64 commitEnd;
        uint64 revealEnd;
        uint64 dareEnd;
        uint256 sealedBids;
        uint256 revealedBids;
        uint256 clearingPrice;
        uint256 totalSupply;
        uint256 curveSold;
        uint256 floorVault;
        uint256 floorPerToken;
        uint256 curveReserve;
        uint256 graduationEscrow;
        uint256 creatorEarnings;
        uint256 spotPrice;
        bool graduated;
        string dare;
        uint256 dareBond;
        string proof;
        bool dareFinalized;
        bool dareAccepted;
        uint256 votesYes;
        uint256 votesNo;
        uint256 tradeCount;
    }

    address public immutable factory;
    address public immutable creator;
    uint64 public immutable openedAt;

    string public slug;
    string public caption;
    string public mediaUrl;
    string public dare;
    string public proof;

    Bid[] internal _bids;
    mapping(address => uint256) internal _bidSlot; // index + 1
    bool public settled;
    uint256 public clearingPrice;

    uint256 public curveSold;
    uint256 public floorVault;
    uint256 public curveReserve;
    uint256 public graduationEscrow;
    uint256 public creatorEarnings;
    bool public graduated;

    uint256 public dareBond;
    bool public dareFinalized;
    bool public dareAccepted;
    address[] internal _voters;
    mapping(address => uint8) public voteOf; // 0 none, 1 yes, 2 no

    Trade[] internal _trades; // ring buffer of MAX_TRADES
    uint256 public tradeCount;

    address[] internal _holderList;
    mapping(address => bool) internal _seen;

    event BidCommitted(address indexed bidder, bytes32 commitment);
    event BidRevealed(address indexed bidder, uint256 amount, uint256 maxPrice);
    event AuctionSettled(uint256 clearingPrice, uint256 sold, uint256 raised);
    event Filled(Kind indexed kind, address indexed account, uint256 quantity, uint256 total, uint256 soldAfter);
    event Graduated(uint256 floorVault, uint256 supply);
    event ProofSubmitted(string proof);
    event Voted(address indexed voter, bool accepted);
    event DareFinalized(bool accepted, uint256 bond);

    error CommitClosed();
    error RevealWindow();
    error SettleWindow();
    error FixedEscrow();
    error TooManyBids();
    error DuplicateBid();
    error NoCommit();
    error BadBid();
    error HashMismatch();
    error EscrowExceeded();
    error NotSettled();
    error NoRefund();
    error CurveClosed();
    error Payment();
    error SellTooLarge();
    error Slippage();
    error Balance();
    error Redeem();
    error OnlyCreator();
    error OnlyFactory();
    error NoDare();
    error ProofWindow();
    error ProofInvalid();
    error VoteWindow();
    error NotHolder();
    error AlreadyVoted();
    error TooManyVoters();
    error DareWindow();
    error TransferFailed();

    constructor(
        string memory slug_,
        string memory name_,
        string memory symbol_,
        address creator_,
        string memory caption_,
        string memory mediaUrl_,
        string memory dare_
    ) payable ERC20(name_, symbol_) {
        factory = msg.sender;
        creator = creator_;
        openedAt = uint64(block.timestamp);
        slug = slug_;
        caption = caption_;
        mediaUrl = mediaUrl_;
        dare = dare_;
        dareBond = msg.value;
    }

    function decimals() public pure override returns (uint8) {
        return 0;
    }

    /* ------------------------------------------------------------------ */
    /* Phase                                                               */
    /* ------------------------------------------------------------------ */

    function commitEnd() public view returns (uint256) {
        return openedAt + COMMIT_SECONDS;
    }

    function revealEnd() public view returns (uint256) {
        return openedAt + COMMIT_SECONDS + REVEAL_SECONDS;
    }

    function dareEnd() public view returns (uint256) {
        return openedAt + DARE_SECONDS;
    }

    function phase() public view returns (Phase) {
        if (block.timestamp < commitEnd()) return Phase.Commit;
        if (block.timestamp < revealEnd()) return Phase.Reveal;
        if (!settled) return Phase.Settle;
        if (graduated) return Phase.Graduated;
        return Phase.Curve;
    }

    /* ------------------------------------------------------------------ */
    /* Sealed-bid opening auction                                          */
    /* ------------------------------------------------------------------ */

    /// @notice The hash a bidder commits to. Bound to this post, this chain and the bidder,
    /// so a commitment cannot be replayed on another post or copied by another account.
    function commitmentOf(address bidder, uint256 amount, uint256 maxPrice, bytes32 salt) public view returns (bytes32) {
        return keccak256(abi.encode("juno:v1", address(this), block.chainid, bidder, amount, maxPrice, salt));
    }

    function commit(bytes32 commitment) external payable nonReentrant {
        if (block.timestamp >= commitEnd()) revert CommitClosed();
        if (msg.value != BID_ESCROW) revert FixedEscrow();
        if (_bids.length >= MAX_BIDS) revert TooManyBids();
        if (_bidSlot[msg.sender] != 0) revert DuplicateBid();
        _bids.push(Bid(msg.sender, false, 0, 0, 0, commitment, 0));
        _bidSlot[msg.sender] = _bids.length;
        emit BidCommitted(msg.sender, commitment);
    }

    function reveal(uint256 amount, uint256 maxPrice, bytes32 salt) external nonReentrant {
        if (block.timestamp < commitEnd() || block.timestamp >= revealEnd()) revert RevealWindow();
        uint256 slot = _bidSlot[msg.sender];
        if (slot == 0) revert NoCommit();
        Bid storage b = _bids[slot - 1];
        if (b.revealed) revert BadBid();
        if (amount == 0 || amount > AUCTION_UNITS || maxPrice < CurveMath.BASE || maxPrice > type(uint128).max) revert BadBid();
        if (b.commitment != commitmentOf(msg.sender, amount, maxPrice, salt)) revert HashMismatch();
        if (amount * maxPrice > BID_ESCROW) revert EscrowExceeded();
        b.revealed = true;
        b.amount = uint16(amount);
        b.maxPrice = uint128(maxPrice);
        emit BidRevealed(msg.sender, amount, maxPrice);
    }

    /// @notice Anyone settles once reveals close. Highest max price fills first
    /// (earlier commit wins a tie); every winner pays the lowest filled bid's price.
    function settle() public nonReentrant {
        _settle();
    }

    function _settle() internal {
        if (settled || block.timestamp < revealEnd()) revert SettleWindow();
        settled = true;
        uint256 n = _bids.length;
        uint256[] memory order = new uint256[](n);
        uint256 m;
        for (uint256 i; i < n; ++i) {
            if (_bids[i].revealed) {
                // Insertion sort, stable: at most 64 bids.
                uint256 j = m;
                uint128 price = _bids[i].maxPrice;
                while (j > 0 && _bids[order[j - 1]].maxPrice < price) {
                    order[j] = order[j - 1];
                    --j;
                }
                order[j] = i;
                ++m;
            }
        }
        uint256 left = AUCTION_UNITS;
        uint256 price_;
        for (uint256 k; k < m && left > 0; ++k) {
            Bid storage b = _bids[order[k]];
            uint256 take = b.amount < left ? b.amount : left;
            b.allocated = uint16(take);
            price_ = b.maxPrice;
            left -= take;
        }
        clearingPrice = price_;
        uint256 raised;
        for (uint256 i; i < n; ++i) {
            Bid storage b = _bids[i];
            if (b.revealed) {
                uint256 paid = uint256(b.allocated) * price_;
                b.refund = BID_ESCROW - paid;
                raised += paid;
            } else {
                // A sealed bid that was never revealed forfeits 1% to the creator.
                uint256 penalty = BID_ESCROW / 100;
                b.refund = BID_ESCROW - penalty;
                creatorEarnings += penalty;
            }
        }
        floorVault += raised / 2;
        graduationEscrow += raised - raised / 2;
        for (uint256 k; k < m; ++k) {
            Bid storage b = _bids[order[k]];
            if (b.allocated > 0) {
                _mint(b.owner, b.allocated);
                _record(Kind.Auction, b.owner, b.allocated, uint256(b.allocated) * price_);
            }
        }
        emit AuctionSettled(price_, AUCTION_UNITS - left, raised);
    }

    function claimRefund() external nonReentrant returns (uint256 refund) {
        if (!settled) revert NotSettled();
        uint256 slot = _bidSlot[msg.sender];
        if (slot == 0) revert NoCommit();
        Bid storage b = _bids[slot - 1];
        refund = b.refund;
        if (refund == 0) revert NoRefund();
        b.refund = 0;
        _pay(msg.sender, refund);
    }

    /* ------------------------------------------------------------------ */
    /* Curve and floor                                                     */
    /* ------------------------------------------------------------------ */

    function _grossBuy(uint256 quantity) internal view returns (uint256) {
        uint256 curve = CurveMath.rangeCost(curveSold, quantity, true);
        uint256 supply = totalSupply();
        uint256 floor_ = supply == 0 ? 0 : (floorVault * quantity + supply - 1) / supply;
        return curve > floor_ ? curve : floor_;
    }

    /// @notice What `quantity` tokens cost right now, everything included.
    function quoteBuy(uint256 quantity) public view returns (uint256 total, uint256 gross, uint256 toFloor, uint256 fee) {
        gross = _grossBuy(quantity);
        toFloor = gross / 5;
        fee = gross / 100;
        total = gross + toFloor + fee;
    }

    /// @notice What selling `quantity` back pays after the 1% fee, and whether the floor pays it.
    function quoteSell(uint256 quantity) public view returns (uint256 payout, bool fromFloor) {
        if (quantity == 0 || quantity > curveSold) revert SellTooLarge();
        uint256 gross = CurveMath.rangeCost(curveSold - quantity, quantity, false);
        uint256 floorGross = (floorVault * quantity) / totalSupply();
        fromFloor = gross < floorGross;
        uint256 actual = fromFloor ? floorGross : gross;
        payout = actual - actual / 100;
    }

    function quoteRedeem(uint256 quantity) public view returns (uint256) {
        uint256 supply = totalSupply();
        if (quantity == 0 || supply == 0 || quantity > supply) return 0;
        uint256 proRata = (floorVault * quantity) / supply;
        return proRata - proRata / 100;
    }

    /// @notice Buy `quantity` tokens. `msg.value` is the most you will pay; the rest comes back.
    /// If the auction has closed but nobody settled it yet, the buy settles it first.
    function buy(uint256 quantity) external payable nonReentrant returns (uint256 total) {
        if (!settled) _settle();
        if (graduated) revert CurveClosed();
        uint256 gross;
        uint256 toFloor;
        uint256 fee;
        (total, gross, toFloor, fee) = quoteBuy(quantity);
        if (msg.value < total) revert Payment();
        floorVault += toFloor;
        curveReserve += gross;
        creatorEarnings += fee / 2;
        graduationEscrow += fee - fee / 2;
        curveSold += quantity;
        _mint(msg.sender, quantity);
        _record(Kind.Buy, msg.sender, quantity, total);
        if (curveSold == CURVE_UNITS) _graduate();
        if (msg.value > total) _pay(msg.sender, msg.value - total);
    }

    function sell(uint256 quantity, uint256 minOut) external nonReentrant returns (uint256 payout) {
        if (!settled || graduated) revert CurveClosed();
        if (quantity == 0 || quantity > curveSold) revert SellTooLarge();
        if (balanceOf(msg.sender) < quantity) revert Balance();
        uint256 supply = totalSupply();
        uint256 gross = CurveMath.rangeCost(curveSold - quantity, quantity, false);
        uint256 floorGross = (floorVault * quantity) / supply;
        uint256 actual;
        if (gross < floorGross) {
            actual = floorGross;
            floorVault -= floorGross;
        } else {
            actual = gross;
            curveReserve -= gross;
        }
        uint256 fee = actual / 100;
        payout = actual - fee;
        if (payout < minOut) revert Slippage();
        creatorEarnings += fee / 2;
        graduationEscrow += fee - fee / 2;
        curveSold -= quantity;
        _burn(msg.sender, quantity);
        _sweepIfEmpty();
        _record(Kind.Sell, msg.sender, quantity, payout);
        _pay(msg.sender, payout);
    }

    /// @notice Burn tokens for 99% of their pro-rata share of the floor vault. Always open once tokens exist.
    function redeem(uint256 quantity, uint256 minOut) external nonReentrant returns (uint256 payout) {
        uint256 supply = totalSupply();
        if (quantity == 0 || supply == 0) revert Redeem();
        if (balanceOf(msg.sender) < quantity) revert Balance();
        uint256 proRata = (floorVault * quantity) / supply;
        payout = proRata - proRata / 100;
        if (payout < minOut) revert Slippage();
        floorVault -= payout;
        _burn(msg.sender, quantity);
        _sweepIfEmpty();
        _record(Kind.Redeem, msg.sender, quantity, payout);
        _pay(msg.sender, payout);
    }

    function withdrawEarnings() external nonReentrant returns (uint256 amount) {
        if (msg.sender != creator) revert OnlyCreator();
        amount = creatorEarnings;
        creatorEarnings = 0;
        if (amount > 0) _pay(creator, amount);
    }

    function _graduate() internal {
        graduated = true;
        floorVault += curveReserve + graduationEscrow;
        curveReserve = 0;
        graduationEscrow = 0;
        emit Graduated(floorVault, totalSupply());
    }

    /// @dev With no tokens left, dust in the vault would be a gift to the next buyer.
    /// Before graduation it goes to the graduation escrow, which only ever returns to holders as floor.
    function _sweepIfEmpty() internal {
        if (totalSupply() == 0 && floorVault > 0 && !graduated) {
            graduationEscrow += floorVault;
            floorVault = 0;
        }
    }

    /* ------------------------------------------------------------------ */
    /* Dare bond                                                           */
    /* ------------------------------------------------------------------ */

    function submitProof(string calldata proof_) external {
        if (msg.sender != creator) revert OnlyCreator();
        if (bytes(dare).length == 0) revert NoDare();
        if (block.timestamp >= dareEnd() || bytes(proof).length != 0) revert ProofWindow();
        if (bytes(proof_).length == 0 || bytes(proof_).length > 300) revert ProofInvalid();
        proof = proof_;
        emit ProofSubmitted(proof_);
    }

    /// @notice Holders vote once on the proof. Weight is each voter's balance when the dare is finalized,
    /// so moving tokens between voters cannot count them twice.
    function vote(bool accepted) external {
        if (bytes(dare).length == 0) revert NoDare();
        if (!settled || bytes(proof).length == 0 || block.timestamp >= dareEnd()) revert VoteWindow();
        if (balanceOf(msg.sender) == 0) revert NotHolder();
        if (voteOf[msg.sender] != 0) revert AlreadyVoted();
        if (_voters.length >= MAX_VOTERS) revert TooManyVoters();
        voteOf[msg.sender] = accepted ? 1 : 2;
        _voters.push(msg.sender);
        emit Voted(msg.sender, accepted);
    }

    function tally() public view returns (uint256 yes, uint256 no) {
        for (uint256 i; i < _voters.length; ++i) {
            address v = _voters[i];
            if (voteOf[v] == 1) yes += balanceOf(v);
            else no += balanceOf(v);
        }
    }

    /// @notice After the dare window anyone finalizes. Accepted proof: the bond returns to the creator.
    /// Missing or rejected proof: the bond joins the floor vault for the holders (or returns to the
    /// creator when nobody holds the coin, since there is nobody to compensate).
    function finalizeDare() external nonReentrant {
        if (bytes(dare).length == 0) revert NoDare();
        if (dareFinalized || block.timestamp < dareEnd()) revert DareWindow();
        if (!settled) _settle();
        dareFinalized = true;
        (uint256 yes, uint256 no) = tally();
        uint256 bond = dareBond;
        dareBond = 0;
        bool accepted = bytes(proof).length != 0 && yes > no;
        dareAccepted = accepted;
        if (accepted || totalSupply() == 0) creatorEarnings += bond;
        else floorVault += bond;
        emit DareFinalized(accepted, bond);
    }

    /* ------------------------------------------------------------------ */
    /* Internals                                                           */
    /* ------------------------------------------------------------------ */

    function _record(Kind kind, address account, uint256 quantity, uint256 total) internal {
        Trade memory t = Trade(uint40(block.timestamp), kind, account, uint16(quantity), uint16(curveSold), uint128(total));
        if (_trades.length < MAX_TRADES) _trades.push(t);
        else _trades[tradeCount % MAX_TRADES] = t;
        ++tradeCount;
        emit Filled(kind, account, quantity, total, curveSold);
    }

    function _pay(address to, uint256 amount) internal {
        (bool ok,) = payable(to).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0) && !settled) revert NotSettled();
        super._update(from, to, value);
        if (to != address(0) && !_seen[to]) {
            _seen[to] = true;
            _holderList.push(to);
        }
    }

    /* ------------------------------------------------------------------ */
    /* Views                                                               */
    /* ------------------------------------------------------------------ */

    function market() external view returns (MarketView memory v) {
        uint256 supply = totalSupply();
        (uint256 yes, uint256 no) = tally();
        uint256 revealed;
        for (uint256 i; i < _bids.length; ++i) if (_bids[i].revealed) ++revealed;
        v.post = address(this);
        v.slug = slug;
        v.creator = creator;
        v.caption = caption;
        v.mediaUrl = mediaUrl;
        v.phase = phase();
        v.openedAt = openedAt;
        v.commitEnd = uint64(commitEnd());
        v.revealEnd = uint64(revealEnd());
        v.dareEnd = uint64(dareEnd());
        v.sealedBids = _bids.length;
        v.revealedBids = revealed;
        v.clearingPrice = clearingPrice;
        v.totalSupply = supply;
        v.curveSold = curveSold;
        v.floorVault = floorVault;
        v.floorPerToken = supply == 0 ? 0 : floorVault / supply;
        v.curveReserve = curveReserve;
        v.graduationEscrow = graduationEscrow;
        v.creatorEarnings = creatorEarnings;
        v.spotPrice = CurveMath.spot(curveSold);
        v.graduated = graduated;
        v.dare = dare;
        v.dareBond = dareBond;
        v.proof = proof;
        v.dareFinalized = dareFinalized;
        v.dareAccepted = dareAccepted;
        v.votesYes = yes;
        v.votesNo = no;
        v.tradeCount = tradeCount;
    }

    /// @notice The newest fills, oldest first (at most MAX_TRADES).
    function trades() external view returns (Trade[] memory list) {
        uint256 n = _trades.length;
        list = new Trade[](n);
        uint256 start = tradeCount > MAX_TRADES ? tradeCount % MAX_TRADES : 0;
        for (uint256 i; i < n; ++i) list[i] = _trades[(start + i) % n];
    }

    /// @notice Every account holding a non-zero balance (unsorted).
    function holders() external view returns (address[] memory accounts, uint256[] memory balances) {
        uint256 n;
        for (uint256 i; i < _holderList.length; ++i) if (balanceOf(_holderList[i]) > 0) ++n;
        accounts = new address[](n);
        balances = new uint256[](n);
        uint256 k;
        for (uint256 i; i < _holderList.length; ++i) {
            uint256 b = balanceOf(_holderList[i]);
            if (b > 0) {
                accounts[k] = _holderList[i];
                balances[k] = b;
                ++k;
            }
        }
    }

    /// @notice One bidder's sealed bid. Amount and price stay zero until revealed.
    function bidOf(address bidder) external view returns (bool exists, Bid memory bid) {
        uint256 slot = _bidSlot[bidder];
        if (slot == 0) return (false, bid);
        return (true, _bids[slot - 1]);
    }

    /// @notice Every bid. Unrevealed bids show only their commitment.
    function bids() external view returns (Bid[] memory) {
        return _bids;
    }

    function voters() external view returns (address[] memory) {
        return _voters;
    }
}
