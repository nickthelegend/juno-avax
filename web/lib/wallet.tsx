import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { decodeErrorResult, encodeFunctionData, formatEther, type Abi, type Address, type Hex } from "viem";
import { client as sdkClient, factoryAbi, FUJI_RPC, mediaAbi, postAbi } from "@juno/sdk";
import { encryptedErcAbi, registrarAbi } from "@juno/sdk/eerc";

import { fujiClient, type TxStep } from "./api";
import { invalidateMarkets } from "./markets";
import { feedChanged } from "./refresh";
import {
  activeWalletName,
  connectWallet,
  disconnectWallet,
  discoverWallets,
  preloadWallet,
  restoreWallet,
  isLocalWallet,
  sendWithWallet,
  signRawWithWallet,
  signWithWallet,
  type WalletOption,
} from "./browser-wallet";
import { canGetGas, getGas } from "./gas";
import { describeTxError, EXPLORER_NAME, FACTORY, TxError } from "./chain";
import { recordConfirmation } from "./finality";
import { money } from "./format";
import { confirmTx } from "./tx-status";
import { SignInSheet } from "../components/SignInSheet";
import { ApproveSheet, type ApprovalRequest } from "../components/ApproveSheet";
import { DEPLOYMENT } from "./deployment";
import { GAS_STATION } from "@juno/sdk";

/**
 * The wallet: Juno on Avalanche, signed by the person's own browser wallet
 * (Core, MetaMask or any EIP-1193 wallet) or by the Juno wallet, a test key
 * made on this device. Every call is a normal Fuji transaction from the
 * person's account. The only server is Juno's gas sponsor, which gives a
 * brand-new, empty wallet its starter test AVAX (lib/gas).
 *
 * Each step is first simulated against Fuji (`eth_call`), so a call the
 * contract would refuse says why before the wallet opens. Then the wallet
 * signs and broadcasts it, and the app waits for the receipt and measures
 * how long Avalanche took to confirm it (see lib/finality).
 */

export type SendProgress = {
  index: number;
  label: string;
  phase: "checking" | "signing" | "confirming" | "confirmed";
  hash?: string;
  /** Broadcast to readable receipt, once confirmed. */
  ms?: number;
  /** Broadcast to the block's own timestamp, when it can be trusted. */
  blockMs?: number | null;
};

export type SendResult = {
  hashes: string[];
  confirmedAt: Date;
  /** Per step, broadcast to receipt. */
  finalityMs: number[];
  /** Per step, broadcast to the block's timestamp (null when this clock is ahead). */
  blockMs: (number | null)[];
};

export type SignInBridge = {
  wallets: () => Promise<WalletOption[]>;
  /** Connects; a brand-new, empty account then gets its starter AVAX (`onStatus` says so while it waits). */
  connect: (id: string, onStatus?: (status: string) => void) => Promise<void>;
};

export type GasState = { phase: "idle" | "asking" | "done" | "failed"; hash?: string; amount?: string; error?: string; setup?: boolean };

export type WalletState = {
  /** The connected account (checksummed), or null when signed out. */
  address: string | null;
  ready: boolean;
  signing: boolean;
  /** The wallet's own name ("Core", "MetaMask"), when connected. */
  walletName: string | null;
  via: "wallet" | null;
  send: (steps: TxStep[], options?: { onProgress?: (progress: SendProgress) => void }) => Promise<SendResult>;
  /** personal_sign with the connected wallet (used once to derive the eERC key; not a transaction). */
  signMessage: (message: string) => Promise<Hex>;
  /** True when the account is the Juno wallet on this device. */
  local: boolean;
  /** The starter-AVAX request for this account, if one was made this session. */
  gas: GasState;
  /** Ask Juno's gas sponsor for this account's starter AVAX (once per wallet, only while empty). */
  getGas: () => Promise<void>;
  connect: () => Promise<string>;
  disconnect: () => Promise<void>;
};

const WalletContext = createContext<WalletState | null>(null);
let big: ReturnType<typeof sdkClient> | null = null;
/** A Fuji client on the official endpoint only, for calls with very large calldata. */
const bigClient = () => (big ??= sdkClient([FUJI_RPC]));
/** Refusals that only mean "not yet" and pass once the next block is stamped. */
const TIME_WINDOWS = new Set(["RevealWindow", "SettleWindow", "DareWindow"]);

const ABIS: Record<TxStep["abi"], Abi> = {
  post: postAbi as Abi,
  factory: factoryAbi as Abi,
  eerc: encryptedErcAbi as Abi,
  registrar: registrarAbi as Abi,
  media: mediaAbi as Abi,
};

/** A simulation refused with a bare selector ("custom error 0x…"): name it from the step's ABI. */
function namedRefusal(error: unknown, abi: Abi) {
  const failure = describeTxError(error);
  if (failure.reason) return failure;
  const text = error instanceof Error ? error.message : String(error ?? "");
  const selector = /custom error (0x[0-9a-fA-F]{8})/.exec(text)?.[1];
  const reason = /reverted with reason:\s*([^.\n]+)/i.exec(text)?.[1]?.trim();
  if (selector) {
    try {
      const name = decodeErrorResult({ abi, data: selector as Hex }).errorName;
      return describeTxError(new Error(`reverted with custom error: ${name}()`));
    } catch {
      /* not in this ABI */
    }
  }
  if (reason === "Auditor public key not set") return { message: "The vault has no auditor yet, so nothing can be shielded.", cancelled: false, reason: null };
  return failure;
}

export function encodeStep(step: TxStep): Hex {
  return encodeFunctionData({ abi: ABIS[step.abi], functionName: step.functionName, args: step.args as unknown[] });
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [walletName, setWalletName] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [signing, setSigning] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [local, setLocal] = useState(false);
  const [gas, setGas] = useState<GasState>({ phase: "idle" });
  const pending = useRef<{ resolve: (address: string) => void; reject: (error: Error) => void } | null>(null);
  // The Juno wallet asks before it signs anything (Core and MetaMask show their own window instead).
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);
  const answer = useRef<((approved: boolean) => void) | null>(null);
  const approve = useCallback(
    (request: ApprovalRequest) =>
      new Promise<void>((resolve, reject) => {
        answer.current = (approved) => {
          answer.current = null;
          setApproval(null);
          if (approved) resolve();
          else reject(new TxError({ message: "", cancelled: true, reason: null }));
        };
        setApproval(request);
      }),
    [],
  );
  /**
   * The connected account, readable by a `send` that was created before the
   * connect finished. A screen that calls `connect()` and then `send()` holds
   * the `send` from its last render, when there was no account yet.
   */
  const current = useRef<string | null>(null);
  const adopt = useCallback((account: string | null) => {
    current.current = account;
    setAddress(account);
  }, []);

  useEffect(() => {
    let live = true;
    restoreWallet()
      .catch(() => null)
      .then((account) => {
        if (!live) return;
        adopt(account);
        setWalletName(account ? activeWalletName() : null);
        setLocal(!!account && isLocalWallet());
        setReady(true);
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (signingIn) preloadWallet();
  }, [signingIn]);

  const connect = useCallback(async () => {
    if (current.current) return current.current;
    pending.current?.reject(new Error("Sign-in replaced"));
    return new Promise<string>((resolve, reject) => {
      pending.current = { resolve, reject };
      setSigningIn(true);
    });
  }, [address]);

  const cancelSignIn = useCallback(() => {
    setSigningIn(false);
    pending.current?.reject(new TxError({ message: "Connect a wallet to continue.", cancelled: true, reason: null }));
    pending.current = null;
  }, []);

  const askGas = useCallback(async (account: string) => {
    setGas({ phase: "asking" });
    try {
      const r = await getGas(account as Address, async (raw) => {
        if (isLocalWallet())
          await approve({
            kind: "sign",
            title: "Ask for free test AVAX",
            account,
            rows: [
              { label: "From", value: `Juno gas station ${shortHex(GAS_STATION)}` },
              { label: "Amount", value: "0.008 test AVAX, once per wallet" },
              { label: "You pay", value: "Nothing: Juno's relayer sends it" },
            ],
          });
        return signRawWithWallet(account as Address, raw);
      });
      setGas({ phase: "done", hash: r.hash, amount: r.amount });
      invalidateMarkets();
      feedChanged();
    } catch (error) {
      const failure = describeTxError(error);
      if (failure.cancelled) {
        setGas({ phase: "idle" });
        return;
      }
      setGas({ phase: "failed", error: error instanceof Error ? error.message : failure.message, setup: (error as Error)?.name === "SetupError" || /^Setup required/.test(String((error as Error)?.message)) });
    }
  }, []);

  const bridge = useMemo<SignInBridge>(
    () => ({
      wallets: discoverWallets,
      connect: async (id, onStatus) => {
        if (!FACTORY) throw new Error("Setup required: EXPO_PUBLIC_JUNO_FACTORY");
        const account = await connectWallet(id).catch((error: unknown) => {
          const failure = describeTxError(error);
          throw new Error(failure.cancelled ? "The wallet closed before you connected." : failure.message);
        });
        adopt(account);
        setWalletName(activeWalletName());
        setGas({ phase: "idle" });
        const isLocal = isLocalWallet();
        setLocal(isLocal);
        // The Juno wallet is new and empty: get its starter AVAX in the same tap.
        if (isLocal && (await canGetGas(account as Address).catch(() => false))) {
          onStatus?.("Getting test AVAX…");
          await askGas(account);
        }
        setSigningIn(false);
        pending.current?.resolve(account);
        pending.current = null;
      },
    }),
    [adopt, askGas],
  );

  const disconnect = useCallback(async () => {
    await disconnectWallet().catch(() => undefined);
    adopt(null);
    setWalletName(null);
    setLocal(false);
    setGas({ phase: "idle" });
  }, [adopt]);

  const requestStarterGas = useCallback(async () => {
    const account = current.current;
    if (!account) throw new TxError({ message: "Connect a wallet to continue.", cancelled: false, reason: null });
    await askGas(account);
  }, [askGas]);

  const send = useCallback<WalletState["send"]>(
    async (steps, options = {}) => {
      const address = current.current;
      if (!address) throw new TxError({ message: "Connect a wallet to continue.", cancelled: false, reason: null });
      if (steps.length === 0) throw new TxError({ message: "Nothing to send.", cancelled: false, reason: null });
      const progress = options.onProgress ?? (() => undefined);
      const client = fujiClient();
      setSigning(true);
      const hashes: string[] = [];
      const finalityMs: number[] = [];
      const blockMs: (number | null)[] = [];
      try {
        for (const [index, step] of steps.entries()) {
          progress({ index, label: step.label, phase: "checking" });
          const value = step.resolveValue ? await step.resolveValue() : BigInt(step.value);
          const data = encodeStep(step);
          // publicnode refuses ~100 kB request bodies (a photo store), so those are checked on the official endpoint only.
          const checker = data.length > 64_000 ? bigClient() : client;
          // Ask Fuji first: a call the contract would refuse fails here, with its reason, before the wallet opens.
          // A time-window refusal right at a boundary is retried for a few seconds: the simulation runs
          // against the latest block, whose timestamp trails this device's clock by up to a block.
          for (let attempt = 0; ; attempt += 1) {
            const failure = await checker
              .call({ account: address as Address, to: step.to, data, value })
              .then(() => null)
              .catch((error: unknown) => namedRefusal(error, ABIS[step.abi]));
            if (!failure) break;
            if (attempt < 4 && failure.reason && TIME_WINDOWS.has(failure.reason)) {
              await new Promise((resolve) => setTimeout(resolve, 1500));
              continue;
            }
            // A step right after one this batch just confirmed (shield after its approval) can be simulated on a
            // public RPC node that has not seen that block yet, and revert with no reason. Ask again shortly.
            if (attempt < 5 && index > 0 && !failure.reason) {
              await new Promise((resolve) => setTimeout(resolve, 1200));
              continue;
            }
            throw new TxError(failure);
          }
          progress({ index, label: step.label, phase: "signing" });
          if (isLocalWallet()) await approve(await txRequest(address, step, value, data, data.length > 64_000 ? bigClient() : client));
          const hash = await sendWithWallet({ from: address as Address, to: step.to, data, value }).catch((error: unknown) => {
            throw new TxError(describeTxError(error));
          });
          progress({ index, label: step.label, phase: "confirming", hash });
          const result = await confirmTx(client, hash).catch((error: unknown) => {
            throw new TxError({
              message: `Sent (${hash.slice(0, 10)}…) but its receipt could not be read: ${describeTxError(error).message} Check ${EXPLORER_NAME}.`,
              cancelled: false,
              reason: null,
            });
          });
          if (!result.ok) {
            throw new TxError({ message: `The contract reverted ${step.label.toLowerCase()} (${hash.slice(0, 10)}…). Check ${EXPLORER_NAME}.`, cancelled: false, reason: null });
          }
          hashes.push(hash);
          finalityMs.push(result.ms);
          blockMs.push(result.blockMs);
          recordConfirmation({ hash, label: step.label, ms: result.ms, blockMs: result.blockMs, at: Date.now() });
          progress({ index, label: step.label, phase: "confirmed", hash, ms: result.ms, blockMs: result.blockMs });
        }
        return { hashes, confirmedAt: new Date(), finalityMs, blockMs };
      } finally {
        if (hashes.length) {
          invalidateMarkets();
          feedChanged();
        }
        setSigning(false);
      }
    },
    [],
  );

  const signMessage = useCallback<WalletState["signMessage"]>(async (message) => {
    const account = current.current;
    if (!account) throw new TxError({ message: "Connect a wallet to continue.", cancelled: false, reason: null });
    if (isLocalWallet())
      await approve({ kind: "sign", title: "Sign this message", account, rows: [{ label: "Message", value: message.length > 160 ? `${message.slice(0, 157)}…` : message }, { label: "Cost", value: "Nothing: a signature is not a transaction" }] });
    return signWithWallet(account as Address, message).catch((error: unknown) => {
      throw new TxError(describeTxError(error));
    });
  }, []);

  const value = useMemo<WalletState>(
    () => ({ address, ready, signing, walletName, via: address ? "wallet" : null, send, signMessage, local, gas, getGas: requestStarterGas, connect, disconnect }),
    [address, ready, signing, walletName, send, signMessage, local, gas, requestStarterGas, connect, disconnect],
  );

  return (
    <WalletContext.Provider value={value}>
      {children}
      <SignInSheet visible={signingIn} onClose={cancelSignIn} bridge={bridge} />
      <ApproveSheet request={approval} onAnswer={(approved) => answer.current?.(approved)} />
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletState {
  const context = useContext(WalletContext);
  if (!context) throw new Error("useWallet must be used inside a WalletProvider");
  return context;
}

const shortHex = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
/** Contracts the app talks to, named for the approval sheet. */
function contractName(to: string): string {
  const t = to.toLowerCase();
  if (FACTORY && t === FACTORY.toLowerCase()) return "Juno factory";
  if (DEPLOYMENT.media && t === String(DEPLOYMENT.media).toLowerCase()) return "JunoMedia";
  if (DEPLOYMENT.eerc && t === DEPLOYMENT.eerc.encryptedERC.toLowerCase()) return "eERC vault";
  if (DEPLOYMENT.eerc && t === DEPLOYMENT.eerc.registrar.toLowerCase()) return "eERC registrar";
  return "Post contract";
}
/** What the approval sheet shows for one transaction: the call, its contract, the AVAX it sends. */
async function txRequest(account: string, step: TxStep, value: bigint, data: Hex, reader: ReturnType<typeof fujiClient>): Promise<ApprovalRequest> {
  const rows = [
    { label: "Calls", value: `${step.functionName}() on ${contractName(step.to)} ${shortHex(step.to)}` },
    { label: "Sends", value: value > 0n ? `${Number(formatEther(value)).toLocaleString("en-US", { maximumSignificantDigits: 6 })} AVAX` : "0 AVAX" },
  ];
  const bytes = (data.length - 2) / 2;
  if (bytes > 4096) rows.push({ label: "Data", value: `${Math.round(bytes / 1000)} kB, stored in this transaction` });
  // The fee estimate is Fuji's own: estimated gas at the current gas price.
  const fee = await Promise.all([reader.estimateGas({ account: account as Address, to: step.to, data, value }), reader.getGasPrice()])
    .then(([gas, price]) => money(Number(formatEther(gas * price)), "AVAX"))
    .catch(() => "set by Fuji when sent");
  rows.push({ label: "Network fee", value: fee.endsWith("AVAX") ? `about ${fee}` : fee });
  return { kind: "tx", title: step.label, account, rows };
}
