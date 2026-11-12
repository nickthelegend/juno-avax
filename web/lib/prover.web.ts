/**
 * Groth16 proving in the browser for the Juno eERC vault: the snarkjs browser
 * build and the eERC circuits (wasm + production zkey) are served from
 * /eerc/ (copied from the pinned Ava Labs submodule at export time). Nothing
 * leaves the device: the witness, the key and the proof are computed here.
 */
import type { Circuit, Prover } from "@juno/sdk/eerc";

type Snarkjs = { groth16: { fullProve: (input: unknown, wasm: string, zkey: string) => Promise<{ proof: never; publicSignals: string[] }> } };
declare global {
  interface Window {
    snarkjs?: Snarkjs;
  }
}

let loading: Promise<Snarkjs> | null = null;

function load(): Promise<Snarkjs> {
  if (window.snarkjs) return Promise.resolve(window.snarkjs);
  loading ??= new Promise<Snarkjs>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/eerc/snarkjs-0.7.5.min.js";
    script.async = true;
    script.onload = () => (window.snarkjs ? resolve(window.snarkjs) : reject(new Error("The prover did not load.")));
    script.onerror = () => {
      loading = null;
      reject(new Error("The prover could not be downloaded. Check your connection and try again."));
    };
    document.head.appendChild(script);
  });
  return loading;
}

/** Start downloading the prover early (the zkeys are fetched by snarkjs when it proves). */
export function warmProver(): void {
  void load().catch(() => undefined);
}

const strings = (v: unknown): unknown => (typeof v === "bigint" ? v.toString() : Array.isArray(v) ? v.map(strings) : v);

export const browserProver: Prover = async (circuit: Circuit, input) => {
  const snarkjs = await load();
  const flat = Object.fromEntries(Object.entries(input).map(([k, v]) => [k, strings(v)]));
  try {
    return await snarkjs.groth16.fullProve(flat, `/eerc/${circuit}.wasm`, `/eerc/${circuit}.zkey`);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    throw new Error(/Assert Failed|Error in template/.test(text) ? "The proof could not be built: the amount does not fit your bag." : `The proof could not be built: ${text.slice(0, 160)}`);
  }
};
