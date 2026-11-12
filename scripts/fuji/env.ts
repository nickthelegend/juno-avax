/**
 * Keys for the Fuji run live only in the repo's gitignored .env. This module
 * reads them by name; nothing here prints a key. `ensureKeys` creates any
 * missing test account (deployer, three players, the QA signer) once.
 */
import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const ENV = join(ROOT, '.env');
export const ROLES = ['JUNO_DEPLOYER_KEY', 'JUNO_MIRA_KEY', 'JUNO_KAI_KEY', 'JUNO_OTO_KEY', 'JUNO_QA_KEY'] as const;
export type Role = (typeof ROLES)[number];

export function readEnv(file = ENV): Record<string, string> {
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (m) out[m[1]!] = m[2]!.replace(/^['"]|['"]$/g, '');
  }
  return out;
}

export function ensureKeys(): void {
  const env = readEnv();
  for (const role of ROLES) {
    if (!env[role]) appendFileSync(ENV, `${role}=${generatePrivateKey()}\n`, { mode: 0o600 });
  }
}

export function account(role: Role) {
  const key = readEnv()[role];
  if (!key) throw Error(`Setup required: ${role} in .env (run scripts/fuji/keys.ts)`);
  return privateKeyToAccount(key as Hex);
}
