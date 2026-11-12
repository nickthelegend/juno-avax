/**
 * How long Avalanche took to confirm each transaction sent from this app.
 *
 * Measured, never assumed. The clock starts when the wallet hands back the
 * transaction hash (it has been broadcast). Two figures come back:
 * - `blockMs`: the block that holds the transaction, by its own millisecond
 *   timestamp, minus the moment of broadcast. On Avalanche a block is final
 *   when it is accepted, so this is time to finality (it trusts this
 *   device's clock, so it is shown only when it is positive).
 * - `ms`: when the public Fuji RPC first returned the receipt; this adds the
 *   RPC's own lag and our polling.
 * Wallet approval time is not counted. Figures live in memory for this visit.
 */
import { useSyncExternalStore } from "react";

export type Confirmation = { hash: string; label: string; ms: number; blockMs: number | null; at: number };

let list: Confirmation[] = [];
const listeners = new Set<() => void>();

export function recordConfirmation(entry: Confirmation) {
  list = [...list, entry].slice(-50);
  listeners.forEach((l) => l());
}

export function useConfirmations(): Confirmation[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => list,
    () => list,
  );
}

/** "0.84 s" */
export function seconds(ms: number): string {
  return ms < 10_000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms / 1000)} s`;
}
