/** Native builds have no eERC prover; the private bag is a web feature. */
import type { Prover } from "@juno/sdk/eerc";

export function warmProver(): void {}
export const browserProver: Prover = async () => {
  throw new Error("Private bags are available in the web app.");
};
