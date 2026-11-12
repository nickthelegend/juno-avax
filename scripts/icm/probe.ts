/**
 * Does a Teleporter (ICM) message from Fuji C-Chain reach Echo without us
 * running a relayer? Sends one message (Fuji gas only, no fee) and polls
 * Echo's TeleporterMessenger.messageReceived(messageID) for three minutes.
 * Result is printed and appended to deployments/fuji.json → icmProbe.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createPublicClient, createWalletClient, http, parseAbi, toHex, decodeEventLog, defineChain } from 'viem';
import { fuji, FUJI_RPC, client } from '@juno/sdk';
import { account, ROOT } from '../fuji/env.ts';

const TELEPORTER = '0x253b2784c75e510dD0fF1da844684a1aC0aa5fcf';
const ECHO_RPC = 'https://subnets.avax.network/echo/testnet/rpc';
const abi = parseAbi([
  'function blockchainID() view returns (bytes32)',
  'function messageReceived(bytes32 messageID) view returns (bool)',
  'struct TeleporterFeeInfo { address feeTokenAddress; uint256 amount; }',
  'struct TeleporterMessageInput { bytes32 destinationBlockchainID; address destinationAddress; TeleporterFeeInfo feeInfo; uint256 requiredGasLimit; address[] allowedRelayerAddresses; bytes message; }',
  'function sendCrossChainMessage(TeleporterMessageInput messageInput) returns (bytes32)',
  'event SendCrossChainMessage(bytes32 indexed messageID, bytes32 indexed destinationBlockchainID, (uint256 messageNonce, address originSenderAddress, bytes32 destinationBlockchainID, address destinationAddress, uint256 requiredGasLimit, address[] allowedRelayerAddresses, (uint256 receivedMessageNonce, address relayerRewardAddress)[] receipts, bytes message) message, (address feeTokenAddress, uint256 amount) feeInfo)',
]);
const echo = createPublicClient({ chain: defineChain({ id: 173750, name: 'Echo', nativeCurrency: { name: 'ECH', symbol: 'ECH', decimals: 18 }, rpcUrls: { default: { http: [ECHO_RPC] } } }), transport: http(ECHO_RPC) });
const pub = client();
const me = account('JUNO_DEPLOYER_KEY');
const destinationBlockchainID = await echo.readContract({ address: TELEPORTER, abi, functionName: 'blockchainID' });
const w = createWalletClient({ account: me, chain: fuji, transport: http(FUJI_RPC) });
const hash = await w.writeContract({ address: TELEPORTER, abi, functionName: 'sendCrossChainMessage', args: [{ destinationBlockchainID, destinationAddress: me.address, feeInfo: { feeTokenAddress: '0x0000000000000000000000000000000000000000', amount: 0n }, requiredGasLimit: 100_000n, allowedRelayerAddresses: [], message: toHex('juno icm probe') }] });
const r = await pub.waitForTransactionReceipt({ hash });
let messageID: `0x${string}` | null = null;
for (const l of r.logs) { try { const e = decodeEventLog({ abi, data: l.data, topics: l.topics }); if (e.eventName === 'SendCrossChainMessage') messageID = e.args.messageID; } catch { /* other */ } }
console.log(`sent ${hash} messageID ${messageID}`);
const t0 = Date.now();
let received = false;
while (Date.now() - t0 < 180_000) {
  received = await echo.readContract({ address: TELEPORTER, abi, functionName: 'messageReceived', args: [messageID!] });
  if (received) break;
  await new Promise((res) => setTimeout(res, 5000));
}
console.log(received ? `delivered to Echo after ${((Date.now() - t0) / 1000).toFixed(0)} s` : 'not delivered within 180 s');
const file = join(ROOT, 'deployments/fuji.json');
const data = JSON.parse(readFileSync(file, 'utf8'));
data.icmProbe = { note: 'scripts/icm/probe.ts: one Teleporter message Fuji C-Chain -> Echo, no relayer fee', tx: hash, messageID, destination: 'Echo', destinationBlockchainID, delivered: received, waitedSeconds: Math.round((Date.now() - t0) / 1000), at: new Date().toISOString() };
writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
