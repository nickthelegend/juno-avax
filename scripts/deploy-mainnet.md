# Deploying Juno to Avalanche C-Chain mainnet

Nothing here has been deployed to mainnet. No agent ran this with `--broadcast` or spent real AVAX. This runbook and `scripts/mainnet/deploy.ts` are for Nick to run himself.

## What it costs

Dry run on 12 Nov 2026 (block 100,105,945, base fee about 7.5 nAVAX/gas), using estimates from `eth_estimateGas` against mainnet:

| Contract | Gas | AVAX |
| --- | ---: | ---: |
| JunoFactory | 4,971,632 | ~0.037 |
| eERC vault (5 verifiers, BabyJubJub, Registrar, EncryptedERC) | 8,940,474 | ~0.067 |
| **Total with the vault** | **13,912,106** | **~0.104** |

The script won't broadcast unless the deployer holds the estimate plus 20%. Each post that someone launches costs that person about 3.9M gas (about 0.03 AVAX at the same base fee).

## Steps

1. **Build and test.** From the repo root, run `pnpm build && pnpm test`. All suites must pass (see TESTING.md).
2. **Dry run.** Run `cd scripts && npx tsx mainnet/deploy.ts`. It checks that the RPC reports chain 43114, then prints gas and cost. It needs no key and sends nothing.
3. **Choose a deployer key you control.** Use a fresh account funded with about 0.05 AVAX for the factory alone. Export the key in your shell only (`export JUNO_MAINNET_DEPLOYER_KEY=0x…`). Never put it in a committed file. The script reads it by name and never prints it.
4. **Deploy the factory.**
   ```bash
   JUNO_MAINNET_CONFIRM=deploy-juno-on-43114 npx tsx mainnet/deploy.ts --broadcast
   ```
   The script waits 10 seconds before it sends (press Ctrl-C to stop). It then writes `deployments/mainnet.json` and refuses to overwrite one that already exists.
5. **The eERC vault (optional, decide first).** A mainnet vault needs an **auditor**: a real person or organisation whose key can read every private amount. Choose who that is, and whether the "Hide your bag" feature should launch on mainnet at all, before you deploy it. The contracts are Ava Labs' audited EncryptedERC (see `contracts/lib/EncryptedERC/audit/`), used unchanged under the Ecosystem License, which allows use on Avalanche mainnet. When you're ready, adapt `scripts/eerc/fuji.ts` (chain, RPC, keys) and run its `deploy` mode.
6. **Verify the source** on Snowtrace (Routescan verifier) the same way the Fuji factory was verified: solc 0.8.28, optimizer 200 runs, via-IR, EVM `cancun`.
7. **Point a mainnet web build at it.** Set `EXPO_PUBLIC_JUNO_FACTORY` to the new address, set the chain constants in `sdk/src/index.ts` (`fuji` → an `avalanche` chain, 43114) and in `web/lib/chain.ts` (network label, explorer `https://snowtrace.io`, no faucet). Then run `pnpm web:export`. The app currently hard-codes Fuji on purpose, so a test build can never sign on mainnet.

## Why it isn't deployed

The Speedrun asks for a working demo, and Fuji gives that without real money. A mainnet launch also means picking a real auditor for private bags and deciding on fees and moderation for public posts. Those are product decisions for Nick, not for a build agent.
