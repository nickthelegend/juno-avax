/**
 * Reads a post's photo back from Fuji. The phone stored it as the calldata of one `JunoMedia.store(bytes)` call;
 * this checks that the transaction called Juno's JunoMedia, succeeded, and emitted `Stored` with the keccak256 of
 * exactly these bytes, then returns them with their image type. Nothing is cached server-side: Fuji is the store.
 */
import { decodeEventLog, decodeFunctionData, keccak256, type Address, type Hex, type PublicClient } from 'viem';
import { mediaAbi } from '@juno/sdk';
import { DEPLOYMENT } from '../../web/lib/deployment.ts';

export const MEDIA = (DEPLOYMENT.media ?? null) as Address | null;

export type Image = { bytes: Uint8Array; type: 'image/jpeg' | 'image/png' | 'image/webp'; by: Address; hash: Hex };
export class MediaError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export function typeOf(b: Uint8Array): Image['type'] | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}

export async function readImage(pub: PublicClient, tx: string): Promise<Image> {
  if (!MEDIA) throw new MediaError('Setup required: JunoMedia is not deployed (deployments/fuji.json → media)', 503);
  if (!/^0x[0-9a-fA-F]{64}$/.test(tx)) throw new MediaError('tx must be a 0x-prefixed 32-byte transaction hash', 400);
  const hash = tx as Hex;
  const [t, r] = await Promise.all([
    pub.getTransaction({ hash }).catch(() => null),
    pub.getTransactionReceipt({ hash }).catch(() => null),
  ]);
  if (!t || !r) throw new MediaError(`No transaction ${hash} on Fuji (yet)`, 404);
  if (t.to?.toLowerCase() !== MEDIA.toLowerCase()) throw new MediaError('That transaction did not call JunoMedia', 422);
  if (r.status !== 'success') throw new MediaError('That store() call reverted', 422);
  const { functionName, args } = decodeFunctionData({ abi: mediaAbi, data: t.input });
  if (functionName !== 'store') throw new MediaError('That transaction is not a store() call', 422);
  const data = args[0] as Hex;
  const digest = keccak256(data);
  const stored = r.logs.filter((l) => l.address.toLowerCase() === MEDIA.toLowerCase()).map((l) => {
    try { return decodeEventLog({ abi: mediaAbi, data: l.data, topics: l.topics }); } catch { return null; }
  }).find((e) => e?.eventName === 'Stored');
  if (!stored || (stored.args as { hash: Hex }).hash !== digest) throw new MediaError('Stored event does not match the bytes', 422);
  const bytes = Buffer.from(data.slice(2), 'hex');
  const type = typeOf(bytes);
  if (!type) throw new MediaError('Not an image', 422);
  return { bytes, type, by: t.from, hash: digest };
}
