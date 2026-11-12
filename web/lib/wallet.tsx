import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { encodeFunctionData, type Abi, type Address, type Hex } from "viem";
import { factoryAbi, postAbi } from "@juno/sdk";

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
  sendWithWallet,
  type WalletOption,
} from "./browser-wallet";
import { describeTxError, EXPLORER_NAME, FACTORY, TxError } from "./chain";
import { recordConfirmation } from "./finality";
import { confirmTx } from "./tx-status";
import { SignInSheet } from "../components/SignInSheet";

/**
 * The wallet: Juno on Avalanche, signed by the person's own browser wallet
 * (Core, MetaMask or any EIP-1193 wallet). There is no Juno server and no
 * relayer: every call is a normal Fuji transaction from the person's account.
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
  connect: (id: string) => Promise<void>;
};

export type WalletState = {
  /** The connected account (checksummed), or null when signed out. */
  address: string | null;
  ready: boolean;
  signing: boolean;
  /** The wallet's own name ("Core", "MetaMask"), when connected. */
  walletName: string | null;
  via: "wallet" | null;
  send: (steps: TxStep[], options?: { onProgress?: (progress: SendProgress) => void }) => Promise<SendResult>;
  connect: () => Promise<string>;
  disconnect: () => Promise<void>;
};

const WalletContext = createContext<WalletState | null>(null);

const ABIS: Record<TxStep["abi"], Abi> = { post: postAbi as Abi, factory: factoryAbi as Abi };

export function encodeStep(step: TxStep): Hex {
  return encodeFunctionData({ abi: ABIS[step.abi], functionName: step.functionName, args: step.args as unknown[] });
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [walletName, setWalletName] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [signing, setSigning] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const pending = useRef<{ resolve: (address: string) => void; reject: (error: Error) => void } | null>(null);

  useEffect(() => {
    let live = true;
    restoreWallet()
      .catch(() => null)
      .then((account) => {
        if (!live) return;
        setAddress(account);
        setWalletName(account ? activeWalletName() : null);
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
    if (address) return address;
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

  const bridge = useMemo<SignInBridge>(
    () => ({
      wallets: discoverWallets,
      connect: async (id) => {
        if (!FACTORY) throw new Error("Setup required: EXPO_PUBLIC_JUNO_FACTORY");
        const account = await connectWallet(id).catch((error: unknown) => {
          const failure = describeTxError(error);
          throw new Error(failure.cancelled ? "The wallet closed before you connected." : failure.message);
        });
        setAddress(account);
        setWalletName(activeWalletName());
        setSigningIn(false);
        pending.current?.resolve(account);
        pending.current = null;
      },
    }),
    [],
  );

  const disconnect = useCallback(async () => {
    await disconnectWallet().catch(() => undefined);
    setAddress(null);
    setWalletName(null);
  }, []);

  const send = useCallback<WalletState["send"]>(
    async (steps, options = {}) => {
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
          // Ask Fuji first: a call the contract would refuse fails here, with its reason, before the wallet opens.
          await client.call({ account: address as Address, to: step.to, data, value }).catch((error: unknown) => {
            throw new TxError(describeTxError(error));
          });
          progress({ index, label: step.label, phase: "signing" });
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
    [address],
  );

  const value = useMemo<WalletState>(
    () => ({ address, ready, signing, walletName, via: address ? "wallet" : null, send, connect, disconnect }),
    [address, ready, signing, walletName, send, connect, disconnect],
  );

  return (
    <WalletContext.Provider value={value}>
      {children}
      <SignInSheet visible={signingIn} onClose={cancelSignIn} bridge={bridge} />
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletState {
  const context = useContext(WalletContext);
  if (!context) throw new Error("useWallet must be used inside a WalletProvider");
  return context;
}
