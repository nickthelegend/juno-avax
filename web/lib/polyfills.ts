/**
 * A few libraries still read a global `Buffer`, and the browser has none.
 * Installed at the very top of the root layout, before anything else loads.
 */
import { Buffer } from "buffer";

const scope = globalThis as { Buffer?: unknown; global?: unknown };
if (typeof scope.Buffer === "undefined") scope.Buffer = Buffer;
if (typeof scope.global === "undefined") scope.global = globalThis;

export {};
