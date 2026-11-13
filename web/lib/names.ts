import { shortAddress as shortAccount } from "./chain";
import { DEPLOYMENT } from "./deployment";

/**
 * Display names for accounts.
 *
 * An Avalanche address has no name of its own. The three accounts that seeded
 * the Fuji demo (listed in deployments/fuji.json) show the names the seed gave
 * them, capitalised as people's names are ("Mira", not "mira"; "QA" for the test signer); every other account shows
 * its short address, 0x1234…cdef. The vault's label ("private bags (eERC)") is not a person and stays as written.
 */
const person = (name: string) => (name === "qa" ? "QA" : name.includes(" ") ? name : name.charAt(0).toUpperCase() + name.slice(1));
const LABELS = new Map<string, string>(Object.entries(DEPLOYMENT.names as Record<string, string>).map(([address, name]) => [address.toLowerCase(), person(name)] as [string, string]));

export function rememberName(_wallet: string, _name: string) {}

export function shortAddress(wallet: string): string {
  return LABELS.get(wallet.toLowerCase()) ?? shortAccount(wallet);
}

export function useName(wallet: string | null | undefined): string | null {
  return wallet ? shortAddress(wallet) : null;
}

export function useHandle(wallet: string | null | undefined): string {
  if (!wallet) return "";
  return shortAddress(wallet);
}
