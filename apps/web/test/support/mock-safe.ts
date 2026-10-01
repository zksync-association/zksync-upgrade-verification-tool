// A stand-in for the Safe Transaction Service, for fork tests and e2e. It serves recorded mainnet
// messages and lets a test add its own (signed by a test owner on the fork). Nothing here talks
// to the real Safe API. Relative imports only, so packages/e2e can load it too.
import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import { type Address, type Hex, concat, getAddress, hexToBigInt } from "viem";
import { safeMessageHashes } from "../../app/common/safe";
import { type GovernanceTypedData, governanceHashes } from "../../app/common/typed-data";
import { SAFE_MESSAGES, type FixtureMessage } from "./fixtures";

type Confirmation = { owner: Address; signature: Hex };

export type MockSafe = {
  url: string;
  add: (input: {
    safe: Address;
    typedData: GovernanceTypedData;
    confirmations: Confirmation[];
  }) => Hex;
  reset: () => void;
  failWith: (status: number | null) => void;
  close: () => Promise<void>;
};

export async function startMockSafe({
  port,
  chainId = 1,
}: { port: number; chainId?: number }): Promise<MockSafe> {
  let store = new Map<string, FixtureMessage[]>();
  let failure: number | null = null;
  const reset = () => {
    store = new Map(
      Object.entries(SAFE_MESSAGES).map(([safe, ms]) => [
        safe.toLowerCase(),
        ms.map((m) => ({ ...m })),
      ])
    );
  };
  reset();

  const add: MockSafe["add"] = ({ safe, typedData, confirmations }) => {
    const { digest } = governanceHashes(typedData);
    const messageHash = safeMessageHashes(chainId, safe, digest).safeMessageHash;
    const list = store.get(safe.toLowerCase()) ?? [];
    const existing = list.find((m) => m.messageHash === messageHash);
    const merged = [
      ...(existing?.confirmations ?? []),
      ...confirmations.map((c) => ({ ...c, signatureType: "EOA" })),
    ];
    // Safe orders owner signatures by owner address, as checkNSignatures requires.
    const sorted = [...new Map(merged.map((c) => [c.owner.toLowerCase(), c])).values()].sort(
      (a, b) => (hexToBigInt(a.owner as Hex) < hexToBigInt(b.owner as Hex) ? -1 : 1)
    );
    const now = new Date().toISOString();
    const message: FixtureMessage = {
      created: existing?.created ?? now,
      modified: now,
      safe: getAddress(safe),
      messageHash,
      message: typedData as unknown as FixtureMessage["message"],
      proposedBy: sorted[0]?.owner ?? safe,
      confirmations: sorted.map((c) => ({
        owner: c.owner,
        signature: c.signature,
        signatureType: "EOA",
      })),
      preparedSignature: concat(sorted.map((c) => c.signature)),
    };
    store.set(safe.toLowerCase(), [message, ...list.filter((m) => m.messageHash !== messageHash)]);
    return messageHash;
  };

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const send = (status: number, body: unknown) => {
      res.writeHead(status, {
        "content-type": "application/json",
        "x-ratelimit-limit": "5000",
        "x-ratelimit-remaining": "4999",
      });
      res.end(JSON.stringify(body));
    };
    // Test-only controls, for tests running in another process (Playwright workers).
    if (req.method === "POST" && url.pathname.startsWith("/__test__/")) {
      let raw = "";
      req.on("data", (chunk) => {
        raw += chunk;
      });
      req.on("end", () => {
        const body = raw ? JSON.parse(raw) : {};
        if (url.pathname === "/__test__/add") return send(200, { messageHash: add(body) });
        if (url.pathname === "/__test__/reset") {
          reset();
          failure = null;
          return send(200, {});
        }
        if (url.pathname === "/__test__/fail") {
          failure = body.status ?? null;
          return send(200, {});
        }
        return send(404, {});
      });
      return;
    }
    if (failure !== null) return send(failure, { detail: "mock failure" });
    const list = url.pathname.match(/^\/api\/v1\/safes\/(0x[0-9a-fA-F]{40})\/messages\/$/);
    if (req.method === "GET" && list) {
      const all = store.get((list[1] as string).toLowerCase()) ?? [];
      const limit = Number(url.searchParams.get("limit") ?? 20);
      const offset = Number(url.searchParams.get("offset") ?? 0);
      return send(200, {
        count: all.length,
        next: null,
        previous: null,
        results: all.slice(offset, offset + limit),
      });
    }
    const one = url.pathname.match(/^\/api\/v1\/messages\/(0x[0-9a-fA-F]{64})\/$/);
    if (req.method === "GET" && one) {
      const hash = (one[1] as string).toLowerCase();
      const found = [...store.values()].flat().find((m) => m.messageHash.toLowerCase() === hash);
      return found ? send(200, found) : send(404, { detail: "Not found." });
    }
    return send(404, { detail: "Not found." });
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));

  return {
    url: `http://127.0.0.1:${port}`,
    add,
    reset,
    failWith: (status) => {
      failure = status;
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
