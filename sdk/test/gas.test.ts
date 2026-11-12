import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recoverMessageAddress } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { client, gasDigest, gasStationAbi, GAS_STATION } from '../src/index.ts';

// Live Fuji: the digest the app signs is the one the deployed JunoGasStation checks.
test('gasDigest matches the deployed JunoGasStation.digest on Fuji', async () => {
  const pub = client(['https://avalanche-fuji-c-chain-rpc.publicnode.com', 'https://api.avax-test.network/ext/bc/C/rpc']);
  const to = privateKeyToAccount(generatePrivateKey()).address;
  const deadline = 1_900_000_000n;
  const onChain = await pub.readContract({ address: GAS_STATION, abi: gasStationAbi, functionName: 'digest', args: [to, deadline] });
  assert.equal(gasDigest(GAS_STATION, to, deadline), onChain);
  const amount = await pub.readContract({ address: GAS_STATION, abi: gasStationAbi, functionName: 'dripAmount' });
  assert.equal(amount, 8n * 10n ** 15n);
});

test('a raw-digest personal_sign recovers to the wallet', async () => {
  const acct = privateKeyToAccount(generatePrivateKey());
  const raw = gasDigest(GAS_STATION, acct.address, 123n);
  const sig = await acct.signMessage({ message: { raw } });
  assert.equal(await recoverMessageAddress({ message: { raw }, signature: sig }), acct.address);
});
