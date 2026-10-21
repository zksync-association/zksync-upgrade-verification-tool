// Remix's loader helpers for the single-file build. Remix sends loader data to the page as JSON;
// React Router hands it over as is, so the same JSON round trip is made here (bigints become
// strings, as the server's BigInt toJSON makes them), and the pages get the shapes they expect.
import { defer as routerDefer, json, redirect } from "react-router-dom";

export { json, redirect };

const roundTrip = (value: unknown) =>
  value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  typeof (value as { then?: unknown } | null)?.then === "function";

export function serialized(value: unknown) {
  return roundTrip(value);
}

export function defer(data: Record<string, unknown>, init?: number | ResponseInit) {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data))
    out[key] = isThenable(value) ? Promise.resolve(value).then(roundTrip) : roundTrip(value);
  return routerDefer(out, init);
}

export function createReadableStreamFromReadable(): never {
  throw new Error("Streaming responses are not used in the single-file build");
}
