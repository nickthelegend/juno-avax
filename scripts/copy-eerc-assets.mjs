// Copies what the browser needs to prove eERC actions into web/public/eerc:
// the circuits and production zkeys from the pinned Ava Labs submodule, the
// snarkjs browser build, and upstream's license. Run before every web export
// (generated, gitignored; the submodule is the source of truth).
import { copyFileSync, createReadStream, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const build = join(root, 'contracts/lib/EncryptedERC/circom/build');
const out = join(root, 'web/public/eerc');
mkdirSync(out, { recursive: true });
const files = {
  'registration.wasm': join(build, 'registration/registration.wasm'),
  'registration.zkey': join(build, 'registration/circuit_final.zkey'),
  'transfer.wasm': join(build, 'transfer/transfer.wasm'),
  'transfer.zkey': join(build, 'transfer/transfer.zkey'),
  'withdraw.wasm': join(build, 'withdraw/withdraw.wasm'),
  'withdraw.zkey': join(build, 'withdraw/circuit_final.zkey'),
  'snarkjs-0.7.5.min.js': join(root, 'scripts/node_modules/snarkjs/build/snarkjs.min.js'),
  'LICENSE-EncryptedERC.md': join(root, 'contracts/lib/EncryptedERC/LICENSE.md'),
};
const sums = [];
for (const [name, from] of Object.entries(files)) {
  copyFileSync(from, join(out, name));
  const h = createHash('sha256');
  await new Promise((ok, fail) => createReadStream(from).on('data', (d) => h.update(d)).on('end', ok).on('error', fail));
  sums.push(`${h.digest('hex')}  ${name}`);
}
writeFileSync(join(out, 'SHA256SUMS'), `${sums.join('\n')}\n`);
console.log(`copied ${sums.length} eERC files into web/public/eerc`);
