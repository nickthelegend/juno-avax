/**
 * Follow a transaction until its receipt is readable, and say whether it worked.
 *
 * Avalanche's C-Chain finalizes a block when it is accepted (Snowman
 * consensus, no reorgs), so a readable receipt is final. The receipt is asked
 * for directly every 60 ms rather than by watching new blocks, so the time
 * measured is the network's and not a polling artefact. `blockMs` is the
 * block's own millisecond timestamp (Granite headers carry one).
 *
 * No React Native imports: scripts run this in Node too.
 */
import type { Hex, PublicClient } from "viem";

export async function confirmTx(
  client: PublicClient,
  hash: Hex,
  timeoutMs = 60_000,
): Promise<{ ok: boolean; ms: number; block: bigint; blockMs: number | null }> {
  const started = performance.now();
  const wall = Date.now();
  for (;;) {
    const receipt = await client.getTransactionReceipt({ hash }).catch(() => null);
    if (receipt) {
      const ms = Math.round(performance.now() - started);
      const block = (await client.request({ method: "eth_getBlockByNumber" as never, params: [`0x${receipt.blockNumber.toString(16)}`, false] as never }).catch(() => null)) as { timestampMilliseconds?: string } | null;
      const raw = block?.timestampMilliseconds ? Number(BigInt(block.timestampMilliseconds)) - wall : null;
      // A negative gap means this device's clock is ahead of the network's; then only `ms` is trustworthy.
      const blockMs = raw !== null && raw >= 0 ? raw : null;
      return { ok: receipt.status === "success", ms, block: receipt.blockNumber, blockMs };
    }
    if (performance.now() - started > timeoutMs) throw new Error("No receipt within a minute");
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
}
