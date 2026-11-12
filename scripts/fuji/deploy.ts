/** Deploys JunoFactory to Fuji from the Foundry artifact and records it in deployments/fuji.json. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createWalletClient, http, type Hex } from 'viem';
import { client, factoryAbi, fuji, FUJI_RPC, FUJI_EXPLORER } from '@juno/sdk';
import { account, ROOT } from './env.ts';

const out = JSON.parse(readFileSync(join(ROOT, 'contracts/out/JunoFactory.sol/JunoFactory.json'), 'utf8'));
const deployer = account('JUNO_DEPLOYER_KEY');
const pub = client();
const wallet = createWalletClient({ account: deployer, chain: fuji, transport: http(FUJI_RPC) });
const hash = await wallet.deployContract({ abi: factoryAbi, bytecode: out.bytecode.object as Hex });
const receipt = await pub.waitForTransactionReceipt({ hash, pollingInterval: 200 });
if (receipt.status !== 'success' || !receipt.contractAddress) throw Error(`deploy failed: ${hash}`);
const file = join(ROOT, 'deployments/fuji.json');
const record = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
record.network = { name: 'Avalanche Fuji C-Chain', chainId: 43113, rpc: FUJI_RPC, explorer: FUJI_EXPLORER };
record.factory = { address: receipt.contractAddress, deployTx: hash, block: Number(receipt.blockNumber), gasUsed: Number(receipt.gasUsed), deployer: deployer.address, deployedAt: new Date().toISOString(), snowtrace: `${FUJI_EXPLORER}/address/${receipt.contractAddress}` };
writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
console.log(`JunoFactory ${receipt.contractAddress} tx ${hash} gas ${receipt.gasUsed}`);
