import type { PublicClient } from 'viem';
import { client, FUJI_RPCS } from '@juno/sdk';

let pub: PublicClient | null = null;
/** One Fuji client per warm instance (two public RPCs behind a fallback). */
export const fujiClient = (): PublicClient => (pub ??= client(FUJI_RPCS));
