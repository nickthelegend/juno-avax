/**
 * @juno/sdk/eerc — "Hide your bag" with Ava Labs' official EncryptedERC (eERC)
 * in converter mode: any post coin can be deposited into one Juno eERC vault,
 * moved privately between registered holders, and withdrawn to sell.
 *
 * This file is the client half of the protocol, written against the circuits
 * and contracts in the pinned submodule contracts/lib/EncryptedERC (commit
 * 8dc98cd): BabyJubJub ElGamal for balances, Poseidon ciphertexts (PCTs) so a
 * holder and the auditor can read amounts, and Groth16 proof inputs for the
 * registration, transfer and withdraw circuits. It runs the same in Node and
 * in the browser: proving is passed in (`Prover`) so the app can use the
 * snarkjs browser build and the scripts the npm package.
 *
 * Nothing secret leaves the caller. A holder's eERC key is derived from one
 * wallet signature over a fixed message (`keyMessage`), so the same wallet
 * always reopens the same bag, and the key is never stored by Juno.
 */
import { Base8, addPoint, mulPointEscalar, subOrder, type Point } from '@zk-kit/baby-jubjub';
import { poseidonDecrypt, poseidonEncrypt } from '@zk-kit/poseidon-cipher';
import { poseidon3 } from 'poseidon-lite';
import { encodeAbiParameters, keccak256, concat, toHex, type Address, type Hex, type PublicClient } from 'viem';

import { encryptedErcAbi, registrarAbi } from './eerc-abi';

export { encryptedErcAbi, registrarAbi };

/** The Juno vault is deployed with 0 decimals, the same as every post coin, so 7 shielded tokens are 7. */
export const EERC_DECIMALS = 0;
/** BN254 scalar field (circuit field). */
export const SNARK_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export type Keypair = {
  /** The circuit's SenderPrivateKey: a BabyJubJub scalar below the subgroup order. */
  secret: bigint;
  publicKey: [bigint, bigint];
};

export type Circuit = 'registration' | 'transfer' | 'withdraw';
export type SnarkProof = { pi_a: string[]; pi_b: string[][]; pi_c: string[] };
export type Prover = (circuit: Circuit, input: Record<string, unknown>) => Promise<{ proof: SnarkProof; publicSignals: string[] }>;
export type ContractProof<N extends number = number> = {
  proofPoints: { a: [bigint, bigint]; b: [[bigint, bigint], [bigint, bigint]]; c: [bigint, bigint] };
  publicSignals: bigint[] & { length: N };
};

/* ------------------------------------------------------------------ */
/* Keys                                                                 */
/* ------------------------------------------------------------------ */

/** The message a holder signs once to open their bag. Bound to the account and the chain. */
export function keyMessage(account: Address, chainId: number): string {
  return [
    'Juno: open your private bag',
    '',
    'Signing this derives your eERC key on this device. It is not a transaction and costs nothing.',
    'Anyone with this signature can read your shielded balances, so only sign it inside Juno.',
    '',
    `Account: ${account.toLowerCase()}`,
    `Chain: ${chainId}`,
  ].join('\n');
}

/**
 * A BabyJubJub scalar from 256 bits of seed. The circuits only need
 * SenderPrivateKey below the subgroup order with SenderPublicKey = sk·Base8;
 * reducing a keccak output mod the ~2^251 order keeps it uniform enough.
 */
export function keypairFromSeed(seed: bigint): Keypair {
  const secret = seed % subOrder || 1n;
  const p = mulPointEscalar(Base8, secret);
  return { secret, publicKey: [p[0], p[1]] };
}

/** A wallet signature (deterministic for RFC 6979 wallets such as Core and MetaMask) becomes the seed, domain-separated. */
export function keypairFromSignature(signature: Hex): Keypair {
  return keypairFromSeed(BigInt(keccak256(concat([toHex('juno:eerc-key:v1'), signature]))));
}

/** CRH(CHAIN_ID | PRIVATE_KEY | ADDRESS), the registration circuit's public hash. */
export function registrationHash(k: Keypair, account: Address, chainId: number | bigint): bigint {
  return poseidon3([BigInt(chainId), k.secret, BigInt(account)]);
}

/* ------------------------------------------------------------------ */
/* ElGamal and Poseidon ciphertexts                                     */
/* ------------------------------------------------------------------ */

/** Uniform in [1, limit) by rejection sampling on limit's bit length. */
function randomBelow(limit: bigint): bigint {
  const bits = limit.toString(2).length;
  const bytes = new Uint8Array(Math.ceil(bits / 8));
  const excess = BigInt(bytes.length * 8 - bits);
  for (;;) {
    globalThis.crypto.getRandomValues(bytes);
    let n = 0n;
    for (const b of bytes) n = (n << 8n) | BigInt(b);
    n >>= excess;
    if (n > 0n && n < limit) return n;
  }
}

const P = (p: readonly bigint[]): Point<bigint> => [p[0]!, p[1]!];

/** ElGamal on BabyJubJub: (r·G, m·G + r·pub). */
export function elgamalEncrypt(publicKey: readonly bigint[], message: bigint, random = randomBelow(subOrder)) {
  const c1 = mulPointEscalar(Base8, random);
  const c2 = addPoint(mulPointEscalar(Base8, message), mulPointEscalar(P(publicKey), random));
  return { c1, c2, random };
}

/** m·G = c2 − secret·c1. */
export function elgamalDecryptPoint(k: Keypair, c1: readonly bigint[], c2: readonly bigint[]): Point<bigint> {
  const s = mulPointEscalar(P(c1), k.secret);
  return addPoint(P(c2), [(SNARK_FIELD - s[0]) % SNARK_FIELD, s[1]]);
}

export type Pct = bigint[]; // [ciphertext(4), authKey(2), nonce]

/** Poseidon-encrypt `values` to `publicKey`; returns the 7-word PCT plus what the circuits need to check it. */
export function encryptPct(values: bigint[], publicKey: readonly bigint[]) {
  const nonce = randomBelow(1n << 128n) + 1n;
  const random = randomBelow(subOrder);
  const sharedKey = mulPointEscalar(P(publicKey), random);
  const authKey = mulPointEscalar(Base8, random);
  const ciphertext = poseidonEncrypt(values, sharedKey, nonce);
  return { pct: [...ciphertext, authKey[0], authKey[1], nonce] as Pct, ciphertext, authKey, nonce, random };
}

/** Decrypt a 7-word PCT with the holder's (or the auditor's) key. Throws if it was not encrypted to this key. */
export function decryptPct(k: Keypair, pct: readonly bigint[], length = 1): bigint[] {
  if (pct.length !== 7) throw Error('A PCT has 7 words.');
  const sharedKey = mulPointEscalar([pct[4]!, pct[5]!], k.secret);
  return poseidonDecrypt(pct.slice(0, 4), sharedKey, pct[6]!, length).slice(0, length);
}

const isZero = (pct: readonly bigint[]) => pct.every((w) => w === 0n);

/* ------------------------------------------------------------------ */
/* Reading a bag                                                        */
/* ------------------------------------------------------------------ */

export type EncryptedBalance = {
  c1: [bigint, bigint];
  c2: [bigint, bigint];
  nonce: bigint;
  amountPCTs: { pct: bigint[]; index: bigint }[];
  balancePCT: bigint[];
  transactionIndex: bigint;
};

export async function encryptedBalance(c: PublicClient, eerc: Address, account: Address, tokenId: bigint): Promise<EncryptedBalance> {
  const [eGCT, nonce, amountPCTs, balancePCT, transactionIndex] = await c.readContract({
    address: eerc,
    abi: encryptedErcAbi,
    functionName: 'balanceOf',
    args: [account, tokenId],
  });
  return {
    c1: [eGCT.c1.x, eGCT.c1.y],
    c2: [eGCT.c2.x, eGCT.c2.y],
    nonce,
    amountPCTs: amountPCTs.map((a) => ({ pct: [...a.pct], index: a.index })),
    balancePCT: [...balancePCT],
    transactionIndex,
  };
}

/**
 * The holder's own view: decrypt the balance PCT and every pending amount PCT,
 * then check the sum against the ElGamal balance the contract keeps (the PCTs
 * are only hints; the ElGamal ciphertext is what the circuits spend).
 */
export function decryptBalance(k: Keypair, b: EncryptedBalance): bigint {
  let total = 0n;
  if (!isZero(b.balancePCT)) total += decryptPct(k, b.balancePCT)[0]!;
  for (const a of b.amountPCTs) if (!isZero(a.pct)) total += decryptPct(k, a.pct)[0]!;
  const empty = b.c1[0] === 0n && b.c1[1] === 0n && b.c2[0] === 0n && b.c2[1] === 0n;
  if (empty) {
    if (total !== 0n) throw Error('The bag has amount hints but no encrypted balance.');
    return 0n;
  }
  const point = elgamalDecryptPoint(k, b.c1, b.c2);
  const expect = total === 0n ? ([0n, 1n] as const) : mulPointEscalar(Base8, total);
  if (point[0] !== expect[0] || point[1] !== expect[1]) throw Error('This key does not open this bag (the encrypted balance does not match its hints).');
  return total;
}

export async function registeredKey(c: PublicClient, registrar: Address, account: Address): Promise<[bigint, bigint] | null> {
  const ok = await c.readContract({ address: registrar, abi: registrarAbi, functionName: 'isUserRegistered', args: [account] });
  if (!ok) return null;
  const pk = await c.readContract({ address: registrar, abi: registrarAbi, functionName: 'getUserPublicKey', args: [account] });
  return [pk[0], pk[1]];
}

export async function auditorKey(c: PublicClient, eerc: Address): Promise<{ address: Address; publicKey: [bigint, bigint] }> {
  const [address, pk] = await Promise.all([
    c.readContract({ address: eerc, abi: encryptedErcAbi, functionName: 'auditor' }),
    c.readContract({ address: eerc, abi: encryptedErcAbi, functionName: 'auditorPublicKey' }),
  ]);
  return { address, publicKey: [pk[0], pk[1]] };
}

/* ------------------------------------------------------------------ */
/* Proof inputs                                                         */
/* ------------------------------------------------------------------ */

export function registrationInput(k: Keypair, account: Address, chainId: number) {
  return {
    SenderPrivateKey: k.secret,
    SenderPublicKey: k.publicKey,
    SenderAddress: BigInt(account),
    ChainID: BigInt(chainId),
    RegistrationHash: registrationHash(k, account, chainId),
  };
}

/** Amount PCT for `deposit(amount, token, amountPCT)`: the depositor's own record of what came in. */
export function depositPct(k: Keypair, amount: bigint): Pct {
  return encryptPct([amount], k.publicKey).pct;
}

export function withdrawInput(k: Keypair, balance: bigint, b: EncryptedBalance, amount: bigint, auditor: readonly bigint[]) {
  if (amount <= 0n) throw Error('Unshield at least one token.');
  if (amount > balance) throw Error(`Only ${balance} shielded.`);
  const next = encryptPct([balance - amount], k.publicKey);
  const audit = encryptPct([amount], auditor);
  return {
    input: {
      ValueToWithdraw: amount,
      SenderPrivateKey: k.secret,
      SenderPublicKey: k.publicKey,
      SenderBalance: balance,
      SenderBalanceC1: b.c1,
      SenderBalanceC2: b.c2,
      AuditorPublicKey: [auditor[0]!, auditor[1]!],
      AuditorPCT: audit.ciphertext,
      AuditorPCTAuthKey: audit.authKey,
      AuditorPCTNonce: audit.nonce,
      AuditorPCTRandom: audit.random,
    },
    balancePCT: next.pct,
  };
}

export function transferInput(k: Keypair, balance: bigint, b: EncryptedBalance, to: readonly bigint[], amount: bigint, auditor: readonly bigint[]) {
  if (amount <= 0n) throw Error('Send at least one token.');
  if (amount > balance) throw Error(`Only ${balance} shielded.`);
  const sender = elgamalEncrypt(k.publicKey, amount);
  const receiver = elgamalEncrypt(to, amount);
  const receiverPct = encryptPct([amount], to);
  const audit = encryptPct([amount], auditor);
  const next = encryptPct([balance - amount], k.publicKey);
  return {
    input: {
      ValueToTransfer: amount,
      SenderPrivateKey: k.secret,
      SenderPublicKey: k.publicKey,
      SenderBalance: balance,
      SenderBalanceC1: b.c1,
      SenderBalanceC2: b.c2,
      SenderVTTC1: sender.c1,
      SenderVTTC2: sender.c2,
      ReceiverPublicKey: [to[0]!, to[1]!],
      ReceiverVTTC1: receiver.c1,
      ReceiverVTTC2: receiver.c2,
      ReceiverVTTRandom: receiver.random,
      ReceiverPCT: receiverPct.ciphertext,
      ReceiverPCTAuthKey: receiverPct.authKey,
      ReceiverPCTNonce: receiverPct.nonce,
      ReceiverPCTRandom: receiverPct.random,
      AuditorPublicKey: [auditor[0]!, auditor[1]!],
      AuditorPCT: audit.ciphertext,
      AuditorPCTAuthKey: audit.authKey,
      AuditorPCTNonce: audit.nonce,
      AuditorPCTRandom: audit.random,
    },
    balancePCT: next.pct,
  };
}

/** snarkjs proof → the eERC `ProofPoints` layout (G2 coordinates swapped, as the Groth16 verifier expects). */
export function contractProof<N extends number>(proof: SnarkProof, publicSignals: string[]): ContractProof<N> {
  const n = (s: string | undefined) => BigInt(s ?? '0');
  return {
    proofPoints: {
      a: [n(proof.pi_a[0]), n(proof.pi_a[1])],
      b: [
        [n(proof.pi_b[0]?.[1]), n(proof.pi_b[0]?.[0])],
        [n(proof.pi_b[1]?.[1]), n(proof.pi_b[1]?.[0])],
      ],
      c: [n(proof.pi_c[0]), n(proof.pi_c[1])],
    },
    publicSignals: publicSignals.map(n) as ContractProof<N>['publicSignals'],
  };
}

/* ------------------------------------------------------------------ */
/* The auditor's view                                                   */
/* ------------------------------------------------------------------ */

export type AuditedMove = {
  kind: 'deposit' | 'transfer' | 'withdraw';
  from: Address;
  to: Address | null;
  tokenId: bigint;
  /** Public on chain for deposits and withdrawals; decrypted from the auditor PCT for transfers. */
  amount: bigint | null;
  block: bigint;
  hash: Hex;
};

/**
 * Every deposit, private transfer and withdrawal into the vault. With the
 * auditor's key, transfer amounts are decrypted from the auditor PCT each
 * transfer proof had to include; without it they stay null.
 */
export async function vaultMoves(c: PublicClient, eerc: Address, fromBlock: bigint, auditor?: Keypair): Promise<AuditedMove[]> {
  const logs = await c.getContractEvents({ address: eerc, abi: encryptedErcAbi, fromBlock, toBlock: 'latest' });
  const out: AuditedMove[] = [];
  for (const log of logs as unknown as { eventName: string; args: Record<string, unknown>; blockNumber: bigint; transactionHash: Hex; transactionIndex: number }[]) {
    const a = log.args;
    if (log.eventName === 'Deposit') {
      out.push({ kind: 'deposit', from: a.user as Address, to: null, tokenId: a.tokenId as bigint, amount: a.amount as bigint, block: log.blockNumber, hash: log.transactionHash });
    } else if (log.eventName === 'Withdraw') {
      out.push({ kind: 'withdraw', from: a.user as Address, to: null, tokenId: a.tokenId as bigint, amount: a.amount as bigint, block: log.blockNumber, hash: log.transactionHash });
    } else if (log.eventName === 'PrivateTransfer') {
      let amount: bigint | null = null;
      if (auditor) {
        try {
          amount = decryptPct(auditor, (a.auditorPCT as readonly bigint[]).map(BigInt))[0]!;
        } catch {
          amount = null;
        }
      }
      out.push({ kind: 'transfer', from: a.from as Address, to: a.to as Address, tokenId: -1n, amount, block: log.blockNumber, hash: log.transactionHash });
    }
  }
  // PrivateTransfer does not carry the token id; read it from the transaction's calldata.
  for (const move of out) {
    if (move.kind !== 'transfer') continue;
    const tx = await c.getTransaction({ hash: move.hash });
    const id = BigInt(`0x${tx.input.slice(2 + 8 + 64, 2 + 8 + 128)}`);
    move.tokenId = id;
  }
  return out;
}

/** A stable short fingerprint of a ciphertext, for showing what the public sees. */
export function ciphertextFingerprint(b: EncryptedBalance): string {
  const h = keccak256(encodeAbiParameters([{ type: 'uint256[4]' }], [[b.c1[0], b.c1[1], b.c2[0], b.c2[1]]]));
  return `${h.slice(2, 10)}…${h.slice(-6)}`;
}
