/**
 * Juno v2.3: deploys JunoMedia (a post's photo stored as the calldata of one `store` call) from Juno's deployer
 * and records it in deployments/fuji.json → media. Keys are read by name from the gitignored .env; none is printed.
 *   npx tsx fuji/media.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createWalletClient, encodeDeployData, http, type Abi, type Address, type Hex } from 'viem';
import { fuji, FUJI_RPC } from '@juno/sdk';
import { account, ROOT } from './env.ts';
import { deployment, pub, record } from './tx.ts';
import { confirmTx } from '../../web/lib/tx-status.ts';

const d = deployment() as Record<string, any>;
if (d.media?.address) {
  console.log(`JunoMedia already at ${d.media.address}`);
  process.exit(0);
}
const deployer = account('JUNO_DEPLOYER_KEY');
const art = JSON.parse(readFileSync(join(ROOT, 'contracts/out/JunoMedia.sol/JunoMedia.json'), 'utf8'));
const wallet = createWalletClient({ account: deployer, chain: fuji, transport: http(FUJI_RPC) });
const prepared = await wallet.prepareTransactionRequest({ data: encodeDeployData({ abi: art.abi as Abi, bytecode: art.bytecode.object as Hex }) } as never);
const hash = await wallet.sendRawTransaction({ serializedTransaction: await wallet.signTransaction(prepared as never) });
const done = await confirmTx(pub, hash);
const r = await pub.getTransactionReceipt({ hash });
if (r.status !== 'success' || !r.contractAddress) throw Error(`deploy reverted: ${hash}`);
record('media', { address: r.contractAddress as Address, deployTx: hash, block: Number(r.blockNumber), confirmMs: done.ms, maxBytes: 120000, at: new Date().toISOString() });
console.log(`JunoMedia ${r.contractAddress} (tx ${hash}, ${done.ms} ms)`);
