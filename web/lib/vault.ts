/**
 * The Juno eERC vault, read from Fuji: Ava Labs' EncryptedERC in converter
 * mode, which any post coin can be shielded into.
 *
 * Three views of the same contract state:
 *  - public: what anyone (a whale-watcher, a copy-trader bot, Snowtrace) can
 *    read — how much of each coin sits in the vault, who has a private bag,
 *    every deposit and withdrawal amount, and transfers with no amount;
 *  - yours: your own bags, decrypted on this device with a key derived from
 *    one wallet signature;
 *  - the auditor's: transfer amounts decrypted from the auditor ciphertext
 *    every proof has to carry — only with the auditor's key.
 */
import { createPublicClient, http, parseAbiItem, type Address, type Hex, type PublicClient } from "viem";
import { fuji, postAbi } from "@juno/sdk";
import {
  auditorKey, ciphertextFingerprint, contractProof, decryptBalance, decryptPct, depositPct, encryptedBalance, encryptedErcAbi, keyMessage,
  keypairFromSignature, registeredKey, registrarAbi, registrationInput, transferInput, withdrawInput, type EncryptedBalance, type Keypair, type Prover,
} from "@juno/sdk/eerc";

import { fujiClient, juno, type Coin, type TxStep } from "./api";
import { CHAIN_ID } from "./chain";
import { DEPLOYMENT } from "./deployment";

export const VAULT = DEPLOYMENT.eerc
  ? {
      encryptedERC: DEPLOYMENT.eerc.encryptedERC as Address,
      registrar: DEPLOYMENT.eerc.registrar as Address,
      auditor: DEPLOYMENT.eerc.auditor as Address,
      startBlock: BigInt(DEPLOYMENT.eerc.startBlock),
      source: DEPLOYMENT.eerc.source,
    }
  : null;

export function requireVault() {
  if (!VAULT) throw new Error("Setup required: the eERC vault address (deployments/fuji.json → eerc)");
  return VAULT;
}

/* ------------------------------------------------------------------ */
/* Logs                                                                 */
/* ------------------------------------------------------------------ */

// The public Fuji endpoints cap eth_getLogs ranges; read in windows the cap allows.
const LOG_RPCS: { url: string; span: bigint }[] = [
  { url: "https://avalanche-fuji-c-chain-rpc.publicnode.com", span: 49_000n },
  { url: "https://api.avax-test.network/ext/bc/C/rpc", span: 2_000n },
];
let logClients: PublicClient[] | null = null;

async function logsOf<T>(read: (c: PublicClient, from: bigint, to: bigint) => Promise<T[]>, from: bigint): Promise<T[]> {
  logClients ??= LOG_RPCS.map((r) => createPublicClient({ chain: fuji, transport: http(r.url, { timeout: 15_000, retryCount: 1 }) }) as PublicClient);
  let lastError: unknown = null;
  for (const [i, c] of logClients.entries()) {
    try {
      const head = await c.getBlockNumber();
      const out: T[] = [];
      for (let start = from; start <= head; start += LOG_RPCS[i]!.span) {
        const end = start + LOG_RPCS[i]!.span - 1n > head ? head : start + LOG_RPCS[i]!.span - 1n;
        out.push(...(await read(c, start, end)));
      }
      return out;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Could not read the vault's history.");
}

/* ------------------------------------------------------------------ */
/* Public view                                                          */
/* ------------------------------------------------------------------ */

export type VaultCoin = {
  address: Address;
  name: string;
  symbol: string;
  art: string | null;
  tokenId: bigint;
  /** Public: how many of this coin the vault contract holds (ERC-20 balanceOf). */
  shielded: number;
  /** Public: the coin's supply, for the share hidden. */
  supply: number;
};

export type VaultMember = { address: Address; publicKey: [bigint, bigint]; block: bigint };

export type VaultMove = {
  kind: "deposit" | "transfer" | "withdraw";
  from: Address;
  to: Address | null;
  coin: Address | null;
  /** Deposits and withdrawals are public. Transfers: null unless decrypted by the auditor. */
  amount: number | null;
  hash: Hex;
  block: bigint;
  time: number | null;
};

export type BagCipher = { member: Address; coin: Address; fingerprint: string; empty: boolean };

export type VaultSnapshot = {
  coins: VaultCoin[];
  members: VaultMember[];
  moves: VaultMove[];
  ciphers: BagCipher[];
  auditor: Address;
  auditorKey: [bigint, bigint];
};

const transferEvent = parseAbiItem("event PrivateTransfer(address indexed from, address indexed to, uint256[7] auditorPCT, address indexed auditorAddress)");
const depositEvent = parseAbiItem("event Deposit(address indexed user, uint256 amount, uint256 dust, uint256 tokenId)");
const withdrawEvent = parseAbiItem("event Withdraw(address indexed user, uint256 amount, uint256 tokenId, uint256[7] auditorPCT, address indexed auditorAddress)");
const registerEvent = parseAbiItem("event Register(address indexed user, (uint256 x, uint256 y) publicKey)");

type RawTransfer = { from: Address; to: Address; pct: bigint[]; hash: Hex; block: bigint };
let lastTransfers: RawTransfer[] = [];

export async function loadVault(): Promise<VaultSnapshot> {
  const v = requireVault();
  const c = fujiClient();
  const tokens = (await c.readContract({ address: v.encryptedERC, abi: encryptedErcAbi, functionName: "getTokens" })) as Address[];
  const [ids, held, supplies, coinList, aud] = await Promise.all([
    Promise.all(tokens.map((t) => c.readContract({ address: v.encryptedERC, abi: encryptedErcAbi, functionName: "tokenIds", args: [t] }))),
    Promise.all(tokens.map((t) => c.readContract({ address: t, abi: postAbi, functionName: "balanceOf", args: [v.encryptedERC] }))),
    Promise.all(tokens.map((t) => c.readContract({ address: t, abi: postAbi, functionName: "totalSupply" }))),
    juno.coins(undefined).then((r) => r.coins).catch(() => [] as Coin[]),
    auditorKey(c, v.encryptedERC),
  ]);
  const meta = new Map((coinList as Coin[]).map((coin) => [coin.address.toLowerCase(), coin]));
  const coins: VaultCoin[] = tokens.map((t, i) => {
    const m = meta.get(t.toLowerCase());
    return {
      address: t,
      name: m?.name ?? `${t.slice(0, 6)}…${t.slice(-4)}`,
      symbol: m?.symbol ?? "POST",
      art: m ? juno.still(m.media) : null,
      tokenId: ids[i]!,
      shielded: Number(held[i]!),
      supply: Number(supplies[i]!),
    };
  });
  const byId = new Map(coins.map((coin) => [coin.tokenId.toString(), coin.address]));

  const [registers, deposits, withdraws, transfers] = await Promise.all([
    logsOf((cl, fromBlock, toBlock) => cl.getLogs({ address: v.registrar, event: registerEvent, fromBlock, toBlock }), v.startBlock),
    logsOf((cl, fromBlock, toBlock) => cl.getLogs({ address: v.encryptedERC, event: depositEvent, fromBlock, toBlock }), v.startBlock),
    logsOf((cl, fromBlock, toBlock) => cl.getLogs({ address: v.encryptedERC, event: withdrawEvent, fromBlock, toBlock }), v.startBlock),
    logsOf((cl, fromBlock, toBlock) => cl.getLogs({ address: v.encryptedERC, event: transferEvent, fromBlock, toBlock }), v.startBlock),
  ]);
  const members: VaultMember[] = registers.map((l) => ({
    address: l.args.user!,
    publicKey: [l.args.publicKey!.x, l.args.publicKey!.y],
    block: l.blockNumber!,
  }));

  // PrivateTransfer carries no token id: it is the second argument of transfer(to, tokenId, …).
  const transferCoins = await Promise.all(
    transfers.map(async (l) => {
      const tx = await c.getTransaction({ hash: l.transactionHash! });
      return byId.get(BigInt(`0x${tx.input.slice(74, 138)}`).toString()) ?? null;
    }),
  );
  lastTransfers = transfers.map((l) => ({ from: l.args.from!, to: l.args.to!, pct: [...l.args.auditorPCT!], hash: l.transactionHash!, block: l.blockNumber! }));

  const moves: VaultMove[] = [
    ...deposits.map((l) => ({ kind: "deposit" as const, from: l.args.user!, to: null, coin: byId.get(l.args.tokenId!.toString()) ?? null, amount: Number(l.args.amount!), hash: l.transactionHash!, block: l.blockNumber!, time: null })),
    ...withdraws.map((l) => ({ kind: "withdraw" as const, from: l.args.user!, to: null, coin: byId.get(l.args.tokenId!.toString()) ?? null, amount: Number(l.args.amount!), hash: l.transactionHash!, block: l.blockNumber!, time: null })),
    ...transfers.map((l, i) => ({ kind: "transfer" as const, from: l.args.from!, to: l.args.to!, coin: transferCoins[i]!, amount: null, hash: l.transactionHash!, block: l.blockNumber!, time: null })),
  ].sort((a, b) => (a.block === b.block ? 0 : a.block > b.block ? -1 : 1));
  const blocks = [...new Set(moves.map((m) => m.block))];
  const stamps = new Map(await Promise.all(blocks.map(async (b) => [b, Number((await c.getBlock({ blockNumber: b })).timestamp) * 1000] as const)));
  for (const m of moves) m.time = stamps.get(m.block) ?? null;

  const ciphers: BagCipher[] = (
    await Promise.all(
      members.flatMap((member) =>
        coins.map(async (coin) => {
          const b = await encryptedBalance(c, v.encryptedERC, member.address, coin.tokenId);
          const empty = b.c1[0] === 0n && b.c2[0] === 0n && b.amountPCTs.length === 0;
          return { member: member.address, coin: coin.address, fingerprint: ciphertextFingerprint(b), empty };
        }),
      ),
    )
  ).filter((x) => !x.empty);

  return { coins, members, moves, ciphers, auditor: aud.address, auditorKey: aud.publicKey };
}

/* ------------------------------------------------------------------ */
/* Your view                                                            */
/* ------------------------------------------------------------------ */

export async function openKey(account: Address, sign: (message: string) => Promise<Hex>): Promise<Keypair> {
  return keypairFromSignature(await sign(keyMessage(account, CHAIN_ID)));
}

export type MyBag = { coin: VaultCoin; balance: number; raw: EncryptedBalance };

export async function myBags(account: Address, key: Keypair, coins: VaultCoin[]): Promise<MyBag[]> {
  const v = requireVault();
  const c = fujiClient();
  return Promise.all(
    coins.map(async (coin) => {
      const raw = await encryptedBalance(c, v.encryptedERC, account, coin.tokenId);
      return { coin, balance: Number(decryptBalance(key, raw)), raw };
    }),
  );
}

export async function isRegistered(account: Address): Promise<[bigint, bigint] | null> {
  return registeredKey(fujiClient(), requireVault().registrar, account);
}

/** The registered key must be the one this signature opens, or the bag cannot be read or spent. */
export async function checkKey(account: Address, key: Keypair): Promise<"new" | "match" | "other"> {
  const onChain = await isRegistered(account);
  if (!onChain) return "new";
  return onChain[0] === key.publicKey[0] && onChain[1] === key.publicKey[1] ? "match" : "other";
}

/* ------------------------------------------------------------------ */
/* Steps for the wallet                                                 */
/* ------------------------------------------------------------------ */

export async function registerStep(account: Address, key: Keypair, prover: Prover): Promise<TxStep> {
  const v = requireVault();
  const { proof, publicSignals } = await prover("registration", registrationInput(key, account, CHAIN_ID));
  return { label: "Open private bag", to: v.registrar, abi: "registrar", functionName: "register", args: [contractProof(proof, publicSignals)], value: "0" };
}

export async function shieldSteps(account: Address, key: Keypair, coin: Address, amount: number): Promise<TxStep[]> {
  const v = requireVault();
  const q = BigInt(amount);
  const allowance = (await fujiClient().readContract({ address: coin, abi: postAbi, functionName: "allowance", args: [account, v.encryptedERC] })) as bigint;
  const steps: TxStep[] = [];
  if (allowance < q) steps.push({ label: "Allow the vault", to: coin, abi: "post", functionName: "approve", args: [v.encryptedERC, q], value: "0" });
  steps.push({ label: "Shield", to: v.encryptedERC, abi: "eerc", functionName: "deposit", args: [q, coin, depositPct(key, q)], value: "0" });
  return steps;
}

export async function sendStep(key: Keypair, bag: MyBag, to: Address, amount: number, auditor: [bigint, bigint], prover: Prover): Promise<TxStep> {
  const v = requireVault();
  const toKey = await isRegistered(to);
  if (!toKey) throw new Error("That account has not opened a private bag yet, so it cannot receive one.");
  const t = transferInput(key, BigInt(bag.balance), bag.raw, toKey, BigInt(amount), auditor);
  const { proof, publicSignals } = await prover("transfer", t.input);
  return { label: "Send privately", to: v.encryptedERC, abi: "eerc", functionName: "transfer", args: [to, bag.coin.tokenId, contractProof(proof, publicSignals), t.balancePCT], value: "0" };
}

export async function unshieldStep(key: Keypair, bag: MyBag, amount: number, auditor: [bigint, bigint], prover: Prover): Promise<TxStep> {
  const v = requireVault();
  const w = withdrawInput(key, BigInt(bag.balance), bag.raw, BigInt(amount), auditor);
  const { proof, publicSignals } = await prover("withdraw", w.input);
  return { label: "Unshield", to: v.encryptedERC, abi: "eerc", functionName: "withdraw", args: [bag.coin.tokenId, contractProof(proof, publicSignals), w.balancePCT], value: "0" };
}

/* ------------------------------------------------------------------ */
/* The auditor's view                                                   */
/* ------------------------------------------------------------------ */

/** Decrypt every private transfer's amount with the auditor key. Wrong key → every amount stays null. */
export function audit(snapshot: VaultSnapshot, key: Keypair): VaultMove[] {
  const amounts = new Map<Hex, number | null>();
  for (const t of lastTransfers) {
    try {
      amounts.set(t.hash, Number(decryptPct(key, t.pct)[0]));
    } catch {
      amounts.set(t.hash, null);
    }
  }
  return snapshot.moves.map((m) => (m.kind === "transfer" ? { ...m, amount: amounts.get(m.hash) ?? null } : m));
}

export function isAuditorKey(snapshot: VaultSnapshot, key: Keypair): boolean {
  return key.publicKey[0] === snapshot.auditorKey[0] && key.publicKey[1] === snapshot.auditorKey[1];
}
