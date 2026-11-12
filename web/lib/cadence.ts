/**
 * How fast Fuji is making blocks right now, from the block headers themselves.
 * Granite-era headers carry `timestampMilliseconds`; the cadence is the
 * average gap over the last 20 blocks. Re-read every 15 s. Null while
 * reading, undefined when the RPC did not answer.
 */
import { useEffect, useState } from "react";

import { fujiClient } from "./api";

type Header = { number: string; timestamp: string; timestampMilliseconds?: string };

export async function blockCadence(span = 20): Promise<{ ms: number; blocks: number; latest: number }> {
  const c = fujiClient();
  const latest = (await c.request({ method: "eth_getBlockByNumber" as never, params: ["latest", false] as never })) as Header;
  const n = BigInt(latest.number);
  const earlier = (await c.request({ method: "eth_getBlockByNumber" as never, params: [`0x${(n - BigInt(span)).toString(16)}`, false] as never })) as Header;
  const t = (h: Header) => (h.timestampMilliseconds ? Number(BigInt(h.timestampMilliseconds)) : Number(BigInt(h.timestamp)) * 1000);
  return { ms: Math.max(1, (t(latest) - t(earlier)) / span), blocks: span, latest: Number(n) };
}

export function useBlockCadence(): { ms: number; blocks: number; latest: number } | null | undefined {
  const [value, setValue] = useState<{ ms: number; blocks: number; latest: number } | null | undefined>(null);
  useEffect(() => {
    let live = true;
    const read = () =>
      blockCadence()
        .then((v) => live && setValue(v))
        .catch(() => live && setValue((prev) => (prev ? prev : undefined)));
    read();
    const id = setInterval(read, 15_000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, []);
  return value;
}
