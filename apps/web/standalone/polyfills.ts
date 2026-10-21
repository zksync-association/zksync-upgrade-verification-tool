// Called first by entry.tsx. (A side-effect-only import would be dropped: apps/web's package.json
// declares "sideEffects": false.)
import { clientEnv } from "./shims/env";

export function installPolyfills() {
  // The server's JSON (and Remix's) writes bigints as strings; so does this build's.
  (BigInt.prototype as unknown as { toJSON(): string }).toJSON = function (this: bigint) {
    return this.toString();
  };
  // Libraries that probe process.env.
  (globalThis as { process?: unknown }).process ??= { env: { NODE_ENV: "production" } };
  // What app/root.tsx's document puts in window.ENV.
  (window as unknown as { ENV: unknown }).ENV = clientEnv;
}
