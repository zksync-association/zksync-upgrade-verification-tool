import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { knownNetwork } from "@/common/networks";
import { defaultLogger } from "@config/log.server";
import { type Address, type Hex, getAddress, hexToBigInt, isAddressEqual, numberToHex } from "viem";
import { z } from "zod";
import {
  L2_GOVERNOR_TOPICS,
  type L2BlockTime,
  dropProvisionalL2Times,
  finalL2BlockTimes,
  indexedL2Governors,
  l2GovernorIndex,
  seedProvisionalL2Times,
} from "../chain/l2-index";
import { type IndexedLog, type ProvisionalOutcome, parseLogs } from "../chain/log-index";
import { puhIndex } from "../chain/puh-index";
import {
  type Network,
  chainIdentity,
  dropProvisionalTimestamps,
  finalBlockTimestamps,
  knownChainIdentity,
  knownL2ChainId,
  l2ChainHead,
  l2ChainId,
  latestBlock,
  network,
  resolvedNetwork,
  rpcGeneration,
  seedProvisionalTimestamps,
} from "../rpc";
import {
  type KeptSafeListing,
  dropLastRunListings,
  holdLastRunListings,
  listingsToKeep,
} from "../safe/store";
import { shouldPrewarm } from "../prewarm";
import { presence } from "../sync/presence";
import { safeMessageSchema } from "../safe-api";

// A local cache of PUBLIC chain data between runs, in apps/web/.cache/chain/ (one file per chain,
// named by chain id and genesis hash): both log histories up to their finality boundary, final
// block timestamps, and member Safes' last message listings. Never a verdict, a governance read, a
// setting, an RPC URL or an API key.
//
// The file is untrusted: validated, then only SEEDED as "provisional". Once this run's backfill has
// covered the seeded range the two are compared: the same logs is "verified", anything else a
// "mismatch" (seeded data and file dropped). Until then only pages may show seeded data, labelled;
// JSON waits for this run's own reads. Written atomically (directory 0700, file 0600) once the
// handler's history is complete, then at most once a minute on change, and on shutdown.

const log = defaultLogger.child({ module: "chain-cache" });

const SCHEMA_VERSION = 1;
// Larger files are not read (the mainnet file is a few megabytes at most).
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_LOGS = 200_000;
const MAX_TIMESTAMPS = 20_000;
const MAX_LISTINGS = 256;
const SAVE_CHECK_MS = 10_000;
const MIN_SAVE_INTERVAL_MS = 60_000;
const FILE_NAME = /^\d+-0x[0-9a-f]{8}\.json$/;

type ChainCacheState = "absent" | "provisional" | "verified" | "mismatch" | "disabled";

export type ChainCacheStatus = {
  state: ChainCacheState;
  /** The file's name (never its path), once one was loaded or saved. */
  file: string | null;
  savedAt: string | null;
  sizeBytes: number | null;
  detail: string | null;
};

/** CHAIN_CACHE=0 (or false/off/no) turns the cache off: nothing is read or written. */
function chainCacheEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return !/^(0|false|off|no)$/i.test(env.CHAIN_CACHE?.trim() ?? "");
}

const quantity = z.string().regex(/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/);
const hash32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const addressHex = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const dataHex = z.string().regex(/^0x(?:[0-9a-fA-F]{2})*$/);

/** A log as eth_getLogs answers it (only the fields the app reads). */
const rawLogSchema = z
  .object({
    address: addressHex,
    topics: z.array(hash32).max(4),
    data: dataHex,
    blockNumber: quantity,
    blockHash: hash32,
    transactionHash: hash32,
    // null when the RPC's answer did not carry it (the index does not require it).
    transactionIndex: quantity.nullable(),
    logIndex: quantity,
  })
  .strict();

const historySchema = {
  deployBlock: quantity,
  coveredFrom: quantity,
  finalizedTo: quantity,
  logs: z.array(rawLogSchema).max(MAX_LOGS),
};

const fileSchema = z
  .object({
    schema: z.literal(SCHEMA_VERSION),
    savedAt: z.string().datetime(),
    chain: z.object({ chainId: z.number().int().positive(), genesisHash: hash32 }).strict(),
    puh: z.object({ ...historySchema, address: addressHex }).strict(),
    l2: z
      .object({
        ...historySchema,
        l2ChainId: z.number().int().positive(),
        addresses: z.array(addressHex).min(1).max(8),
        topic0: z.array(hash32).min(1).max(8),
      })
      .strict()
      .nullable(),
    timestamps: z
      .object({
        l1: z.array(z.tuple([quantity, quantity])).max(MAX_TIMESTAMPS),
        l2: z.array(z.tuple([hash32, quantity, quantity])).max(MAX_TIMESTAMPS),
      })
      .strict(),
    safe: z
      .object({
        service: z.string().min(1).max(200),
        listings: z
          .array(
            z
              .object({
                safe: addressHex,
                fetchedAt: z.number().int().nonnegative(),
                complete: z.boolean(),
                messages: z.array(safeMessageSchema).max(500),
              })
              .strict()
          )
          .max(MAX_LISTINGS),
      })
      .strict()
      .nullable(),
  })
  .strict();

type CacheFile = z.infer<typeof fileSchema>;
type RawLog = z.infer<typeof rawLogSchema>;

const hex = (n: bigint | number) => numberToHex(n);
const big = (value: string) => hexToBigInt(value as Hex);

function toRawLog(entry: IndexedLog): RawLog {
  return {
    address: entry.address.toLowerCase(),
    topics: [...entry.topics],
    data: entry.data,
    blockNumber: hex(entry.blockNumber),
    blockHash: entry.blockHash,
    transactionHash: entry.transactionHash,
    // Typed as a number, but null when the RPC left it out (viem's formatLog).
    transactionIndex:
      typeof entry.transactionIndex === "number" ? hex(entry.transactionIndex) : null,
    logIndex: hex(entry.logIndex),
  };
}

export function chainCacheFileName(identity: { chainId: number; genesisHash: Hex }): string {
  return `${identity.chainId}-${identity.genesisHash.toLowerCase().slice(0, 10)}.json`;
}

/** The Safe service the listings came from: the pinned one by origin, any other by a URL hash. */
function safeServiceId(net: Pick<Network, "chainId" | "safeTxServiceUrl">): string | null {
  const url = net.safeTxServiceUrl;
  if (!url) return null;
  const pinned = knownNetwork(net.chainId)?.safeTxServiceUrl ?? null;
  if (url === pinned) {
    try {
      return new URL(url).origin;
    } catch {
      return null;
    }
  }
  return `sha256:${createHash("sha256").update(url).digest("hex").slice(0, 32)}`;
}

type Seedable = "puh" | "l2";

const state = {
  dir: null as string | null,
  fixed: null as "mismatch" | "disabled" | null,
  loaded: false,
  pending: new Set<Seedable>(),
  verified: new Set<Seedable>(),
  loadedPath: null as string | null,
  file: null as string | null,
  savedAt: null as string | null,
  sizeBytes: null as number | null,
  detail: null as string | null,
  lastSignature: null as string | null,
  lastSaveAt: 0,
  lastSaveError: null as string | null,
  saver: null as ReturnType<typeof setInterval> | null,
  saving: null as Promise<boolean> | null,
  /** Bumped by stopChainCache(): outcomes from before are ignored. */
  epoch: 0,
};

const directory = () => state.dir ?? resolve(".cache/chain");

/** What the cache is doing, for /api/status (`sync.cache`). Never a path or a URL. */
export function chainCacheStatus(): ChainCacheStatus {
  const current: ChainCacheState = !chainCacheEnabled()
    ? "disabled"
    : state.fixed ??
      (state.pending.size > 0 ? "provisional" : state.verified.size > 0 ? "verified" : "absent");
  return {
    state: current,
    file: state.file,
    savedAt: state.savedAt,
    sizeBytes: state.sizeBytes,
    detail: !chainCacheEnabled() ? "CHAIN_CACHE=0" : state.detail,
  };
}

function outcomeHandler(kind: Seedable, epoch: number) {
  return (outcome: ProvisionalOutcome) => {
    if (epoch !== state.epoch || !state.pending.has(kind)) return;
    if (outcome === "mismatch") {
      discard(kind === "puh" ? "The ProtocolUpgradeHandler history" : "The L2 governors' history");
      return;
    }
    state.pending.delete(kind);
    if (outcome === "verified") {
      state.verified.add(kind);
      log.info({ history: kind }, "Chain cache history from the last run verified");
    }
  };
}

// The last run's data did not match the chain: everything seeded from it is dropped. A file this
// run has not saved over is deleted; one it has is saved again without it (or deleted on failure).
function discard(what: string) {
  if (state.fixed === "mismatch") return;
  state.fixed = "mismatch";
  state.pending.clear();
  state.detail = `${what} from the last run did not match the chain; the cached data was discarded.`;
  puhIndex().dropProvisional();
  l2GovernorIndex().dropProvisional();
  dropProvisionalTimestamps();
  dropProvisionalL2Times();
  dropLastRunListings();
  const loaded = state.loadedPath;
  const target = loaded ?? (state.file ? join(directory(), state.file) : null);
  state.loadedPath = null;
  const epoch = state.epoch;
  // After a save in flight (it may have collected the dropped data), never beside it.
  const inFlight = state.saving ?? Promise.resolve(false);
  void inFlight.then(async (wrote) => {
    if (epoch !== state.epoch || !target) return;
    const resave = loaded === null || wrote;
    if (resave && (await saveChainCache({ force: true }))) return;
    if (epoch === state.epoch) await rm(target, { force: true }).catch(() => {});
  });
  log.warn({ file: state.file, what }, "Chain cache from the last run did not match the chain");
}

function ignore(detail: string) {
  state.detail = detail;
  log.info({ detail }, "Chain cache not used");
}

/** Loads and seeds the file for the chain, then keeps saving; never rejects (`dir`: tests). */
export async function loadChainCache({ dir }: { dir?: string } = {}): Promise<void> {
  if (dir !== undefined) state.dir = dir;
  // A page's read that may answer from the file waits for it (bounded); Era's part may come later.
  const loaded = signal();
  const l2Seeded = signal();
  if (chainCacheEnabled() && !state.loaded) {
    puhIndex().expectSeed(loaded.promise);
    l2GovernorIndex().expectSeed(l2Seeded.promise);
  }
  let l2Handed = false;
  try {
    await load((l2) => {
      l2Handed = true;
      void l2.finally(l2Seeded.resolve);
    });
  } catch (error) {
    ignore(`The cache could not be checked (${errorKind(error)}); it was not used.`);
  } finally {
    loaded.resolve();
    if (!l2Handed) l2Seeded.resolve();
  }
  // The saver never asks the node while the app is idle: what a save needs (the chain's identity,
  // Era's chain id) is read once now, unless PREWARM=0 keeps the start silent.
  void readIdentities();
  startSaver();
}

async function readIdentities() {
  if (!chainCacheEnabled() || state.fixed === "disabled" || !shouldPrewarm()) return;
  const net = await network().catch(() => null);
  if (!net || net.isDevNode) return;
  await Promise.all([chainIdentity().catch(() => null), l2ChainId().catch(() => null)]);
}

function signal(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

async function load(onL2: (seeded: Promise<void>) => void) {
  if (state.loaded) return;
  state.loaded = true;
  if (!chainCacheEnabled()) return;
  const started = performance.now();
  const generation = rpcGeneration();
  const devNode = (net: Network) => {
    if (!net.isDevNode) return false;
    state.fixed = "disabled";
    state.detail = "Dev nodes can be rewound: nothing is cached.";
    return true;
  };
  // Nothing saved at all: no need to ask the chain anything but what the warm-up asks anyway.
  const names = await readdir(directory()).catch(() => [] as string[]);
  if (!names.some((name) => FILE_NAME.test(name))) {
    devNode(await network());
    return;
  }
  const [net, identity, head] = await Promise.all([network(), chainIdentity(), latestBlock()]);
  if (devNode(net) || rpcGeneration() !== generation) return;
  const name = chainCacheFileName(identity);
  if (!names.includes(name)) return ignore("No cache for this chain.");
  const path = join(directory(), name);
  const size = (await stat(path)).size;
  if (size > MAX_FILE_BYTES)
    return ignore(`The cache file is larger than ${MAX_FILE_BYTES} bytes; it was ignored.`);
  let parsed: CacheFile;
  try {
    const result = fileSchema.safeParse(JSON.parse(await readFile(path, "utf8")));
    if (!result.success)
      return ignore("The cache file is not in the expected format; it was ignored.");
    parsed = result.data;
  } catch {
    return ignore("The cache file is not valid JSON; it was ignored.");
  }
  if (
    parsed.chain.chainId !== identity.chainId ||
    parsed.chain.genesisHash.toLowerCase() !== identity.genesisHash.toLowerCase()
  )
    return ignore("The cache file is for another chain; it was ignored.");
  // A history whose last block is not even mined yet at this chain's head is not this chain's.
  if (big(parsed.puh.finalizedTo) > head.number)
    return ignore("The cache file holds blocks beyond the chain's head; it was ignored.");
  let checked: Checked;
  try {
    checked = check(parsed, net);
  } catch (error) {
    if (error instanceof OtherHandler)
      return ignore("The cache file is for another ProtocolUpgradeHandler; it was ignored.");
    return ignore(
      `The cache file holds data the app does not accept (${error instanceof Error ? error.message : "invalid"}); it was ignored.`
    );
  }
  if (rpcGeneration() !== generation) return;
  state.file = name;
  state.savedAt = parsed.savedAt;
  state.sizeBytes = size;
  state.loadedPath = path;
  state.detail = null;
  onL2(seed(checked, net, state.epoch));
  log.info(
    {
      file: name,
      savedAt: parsed.savedAt,
      handlerLogs: checked.puh.logs.length,
      l2Logs: checked.l2?.logs.length ?? 0,
      safes: checked.listings.length,
      timestamps: checked.l1Times.size + checked.l2Times.length,
      ms: Math.round(performance.now() - started),
    },
    "Chain cache loaded from the last run; re-verifying"
  );
}

type Checked = {
  puh: { address: Address; deployBlock: bigint; finalizedTo: bigint; logs: IndexedLog[] };
  l2: {
    l2ChainId: number;
    addresses: Address[];
    fromBlock: bigint;
    finalizedTo: bigint;
    logs: IndexedLog[];
  } | null;
  l1Times: Map<bigint, bigint>;
  l2Times: L2BlockTime[];
  listings: KeptSafeListing[];
};

class OtherHandler extends Error {}

// Everything in the file checked as if it came from the chain (complete histories, parseLogs); an
// L2 history for other governors is left out. Throws when anything is invalid or another handler's.
function check(file: CacheFile, net: Network): Checked {
  const address = getAddress(file.puh.address);
  const deployBlock = big(file.puh.deployBlock);
  const finalizedTo = big(file.puh.finalizedTo);
  if (big(file.puh.coveredFrom) !== deployBlock || finalizedTo < deployBlock)
    throw new Error("an incomplete handler history");
  const puh = {
    address,
    deployBlock,
    finalizedTo,
    logs: parseLogs(file.puh.logs, { addresses: [address] }, deployBlock, finalizedTo),
  };
  if (!isAddressEqual(address, net.upgradeHandler) || deployBlock !== net.upgradeHandlerDeployBlock)
    throw new OtherHandler();

  let l2: Checked["l2"] = null;
  if (file.l2) {
    const addresses = file.l2.addresses.map((a) => getAddress(a));
    const fromBlock = big(file.l2.deployBlock);
    const finalizedTo = big(file.l2.finalizedTo);
    if (big(file.l2.coveredFrom) !== fromBlock || finalizedTo < fromBlock)
      throw new Error("an incomplete L2 governor history");
    const topics = new Set(file.l2.topic0.map((t) => t.toLowerCase()));
    const sameTopics =
      topics.size === L2_GOVERNOR_TOPICS.length && L2_GOVERNOR_TOPICS.every((t) => topics.has(t));
    const logs = parseLogs(
      file.l2.logs,
      { addresses, topic0: [...topics] as Hex[] },
      fromBlock,
      finalizedTo
    );
    const indexed = indexedL2Governors(net);
    const sameGovernors =
      indexed !== null &&
      indexed.fromBlock === fromBlock &&
      indexed.addresses.length === addresses.length &&
      indexed.addresses.every((a, i) => isAddressEqual(a, addresses[i] as Address));
    if (sameTopics && sameGovernors)
      l2 = { l2ChainId: file.l2.l2ChainId, addresses, fromBlock, finalizedTo, logs };
  }

  const l1Times = new Map<bigint, bigint>();
  for (const [n, t] of file.timestamps.l1) l1Times.set(big(n), big(t));
  const l2Times = file.timestamps.l2.map(([hash, n, t]) => ({
    hash: hash.toLowerCase() as Hex,
    number: big(n),
    timestamp: big(t),
  }));

  const service = safeServiceId(net);
  // The last run's listings were answered before this run started: one the file says Safe
  // answered later is left out (its age could not be shown truthfully).
  const now = Date.now();
  const listings: KeptSafeListing[] =
    file.safe && service !== null && file.safe.service === service
      ? file.safe.listings
          .filter((listing) => listing.fetchedAt <= now)
          .map((listing) => ({
            safe: getAddress(listing.safe),
            messages: listing.messages,
            complete: listing.complete,
            fetchedAt: listing.fetchedAt,
          }))
      : [];
  return { puh, l2, l1Times, l2Times, listings };
}

/** Seeds what the file holds; the promise settles once Era's part is seeded or left out. */
function seed(checked: Checked, net: Network, epoch: number): Promise<void> {
  const onMismatch = (what: string) => () => {
    if (epoch === state.epoch) discard(what);
  };
  if (checked.l1Times.size > 0)
    seedProvisionalTimestamps(checked.l1Times, onMismatch("An L1 block timestamp"));
  if (checked.l2Times.length > 0)
    seedProvisionalL2Times(checked.l2Times, onMismatch("A ZKsync Era block timestamp"));
  if (checked.listings.length > 0) holdLastRunListings(checked.listings);
  // The handler's history last, and pending first: its outcome may be told at once. A mismatch
  // then drops everything seeded above, and nothing of the file is seeded after it.
  state.pending.add("puh");
  puhIndex().seedProvisional(
    {
      chainId: net.chainId,
      address: checked.puh.address,
      deployBlock: checked.puh.deployBlock,
      finalizedTo: checked.puh.finalizedTo,
      logs: checked.puh.logs,
    },
    outcomeHandler("puh", epoch)
  );
  const l2 = checked.l2;
  if (!l2 || state.fixed === "mismatch") return Promise.resolve();
  // Era is another provider: its chain id (and head: a history beyond it is not this chain's)
  // is checked without holding anything else up.
  const generation = rpcGeneration();
  state.pending.add("l2");
  return Promise.all([l2ChainId().catch(() => null), l2ChainHead().catch(() => null)]).then(
    ([id, head]) => {
      // Meanwhile the file may have been found wrong (nothing dropped this unseeded part), or the
      // cache stopped: nothing of it is seeded now.
      if (epoch !== state.epoch || state.fixed === "mismatch" || !state.pending.has("l2")) return;
      const handler = outcomeHandler("l2", epoch);
      if (
        id !== l2.l2ChainId ||
        !head ||
        l2.finalizedTo > head.head.number ||
        rpcGeneration() !== generation
      )
        return handler("dropped");
      l2GovernorIndex().seedProvisional(
        {
          chainId: net.chainId,
          l2ChainId: l2.l2ChainId,
          addresses: l2.addresses,
          fromBlock: l2.fromBlock,
          finalizedTo: l2.finalizedTo,
          logs: l2.logs,
        },
        handler
      );
    }
  );
}

function startSaver() {
  if (state.saver || !chainCacheEnabled()) return;
  const timer = setInterval(() => void saveChainCache({ force: false }), SAVE_CHECK_MS);
  (timer as { unref?: () => void }).unref?.();
  state.saver = timer;
}

/**
 * Saves once the handler's history is complete: with `force` (shutdown) now, else only on change
 * and at most once a minute. Resolves whether it wrote the file; never rejects.
 */
export function saveChainCache({ force = true }: { force?: boolean } = {}): Promise<boolean> {
  // One save at a time. A forced save (shutdown, a discard) never stands in for a check that may
  // skip writing, nor one that collected before what it must write: it runs after it.
  if (state.saving)
    return force ? state.saving.then(() => saveChainCache({ force: true })) : state.saving;
  const saving = save(force)
    .catch((error: unknown) => {
      const kind = (error as NodeJS.ErrnoException)?.code ?? errorKind(error);
      state.detail = `The cache could not be saved (${kind}).`;
      if (state.lastSaveError !== kind) log.warn({ error: kind }, "Chain cache not saved");
      state.lastSaveError = kind;
      return false;
    })
    .finally(() => {
      if (state.saving === saving) state.saving = null;
    });
  state.saving = saving;
  return saving;
}

async function save(force: boolean): Promise<boolean> {
  if (!chainCacheEnabled() || state.fixed === "disabled") return false;
  const generation = rpcGeneration();
  // The saver's checks never ask the node while nobody uses the app: they use what this run has
  // read, and skip until it has. In use (sync/presence.ts), a check reads what is missing; saving
  // at shutdown may ask.
  const mayRead = force || presence().inUse();
  const known = force ? null : resolvedNetwork();
  const net = force ? await network() : known;
  if (!net || net.isDevNode) return false;
  const identity = force
    ? await chainIdentity()
    : knownChainIdentity() ?? (mayRead ? await chainIdentity().catch(() => null) : null);
  if (!identity) return false;
  const contents = await collect(net, identity, mayRead);
  if (!contents || rpcGeneration() !== generation) return false;
  const now = Date.now();
  if (!force) {
    if (contents.signature === state.lastSignature) return false;
    if (state.lastSaveAt !== 0 && now - state.lastSaveAt < MIN_SAVE_INTERVAL_MS) return false;
  }
  const file = contents.build();
  const json = JSON.stringify(file);
  const name = chainCacheFileName(identity);
  await writeAtomically(directory(), name, json);
  state.lastSignature = contents.signature;
  state.lastSaveAt = now;
  state.lastSaveError = null;
  // This run's own data is on disk now: a later mismatch has nothing of the last run's to delete.
  state.loadedPath = null;
  state.file = name;
  state.savedAt = file.savedAt;
  state.sizeBytes = Buffer.byteLength(json);
  if (state.detail?.startsWith("The cache could not be saved")) state.detail = null;
  return true;
}

// What this run would save (built only when saved); null until the handler's history is complete.
// The signature changes with what is worth a save, not with the time of the last Safe check.
async function collect(
  net: Network,
  identity: { chainId: number; genesisHash: Hex },
  mayRead: boolean
): Promise<{ build: () => CacheFile; signature: string } | null> {
  const puh = puhIndex().snapshot();
  if (!puh || puh.chainId !== identity.chainId) return null;
  const l2 = l2GovernorIndex().snapshot();
  const l2Id =
    l2 && l2.chainId === identity.chainId
      ? mayRead
        ? await l2ChainId().catch(() => null)
        : knownL2ChainId()
      : null;
  const l1Times = [...finalBlockTimestamps()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const l2Times = finalL2BlockTimes();
  const service = safeServiceId(net);
  const listings = service === null ? [] : listingsToKeep().slice(0, MAX_LISTINGS);
  const build = (): CacheFile => ({
    schema: SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    chain: { chainId: identity.chainId, genesisHash: identity.genesisHash.toLowerCase() },
    puh: {
      address: puh.address.toLowerCase(),
      deployBlock: hex(puh.coveredFrom),
      coveredFrom: hex(puh.coveredFrom),
      finalizedTo: hex(puh.finalizedTo),
      logs: puh.logs.map(toRawLog),
    },
    l2:
      l2 && l2Id !== null
        ? {
            l2ChainId: l2Id,
            addresses: l2.addresses.map((a) => a.toLowerCase()),
            topic0: [...L2_GOVERNOR_TOPICS],
            deployBlock: hex(l2.coveredFrom),
            coveredFrom: hex(l2.coveredFrom),
            finalizedTo: hex(l2.finalizedTo),
            logs: l2.logs.map(toRawLog),
          }
        : null,
    timestamps: {
      l1: l1Times.slice(0, MAX_TIMESTAMPS).map(([n, t]) => [hex(n), hex(t)]),
      l2: l2Times.slice(0, MAX_TIMESTAMPS).map((t) => [t.hash, hex(t.number), hex(t.timestamp)]),
    },
    safe:
      service === null
        ? null
        : {
            service,
            listings: listings.map(({ safe, messages, complete, fetchedAt }) => ({
              safe: safe.toLowerCase(),
              fetchedAt,
              complete,
              messages,
            })),
          },
  });
  // The logs are this run's (complete, only ever growing): their count names them. Timestamps may
  // be replaced (one the last run read, dropped, then read again in this run): their values count.
  const digest = createHash("sha256");
  digest.update(
    [
      chainCacheFileName(identity),
      puh.logs.length,
      l2 && l2Id !== null ? `${l2Id}:${l2.logs.length}` : "-",
      listings.map((l) => `${l.safe}:${l.version}`).join(","),
    ].join("|")
  );
  for (const [n, t] of l1Times) digest.update(`|${n}:${t}`);
  digest.update("|l2");
  for (const t of l2Times) digest.update(`|${t.hash}:${t.number}:${t.timestamp}`);
  return { build, signature: digest.digest("hex") };
}

async function writeAtomically(dir: string, name: string, json: string) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700).catch(() => {});
  const temporary = join(dir, `.${name}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
  try {
    await writeFile(temporary, json, { mode: 0o600, flag: "wx" });
    await rename(temporary, join(dir, name));
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

/** A class name such as "SyntaxError", never the error's text (it can carry a URL). */
function errorKind(error: unknown): string {
  const name = error instanceof Error ? error.name : typeof error;
  return /^[A-Za-z]\w{0,63}$/.test(name) ? name : "Error";
}

/** Stops saving and forgets everything (tests). Outcomes of earlier seeds are ignored after. */
export function stopChainCache() {
  if (state.saver) clearInterval(state.saver);
  state.saver = null;
  state.epoch++;
  state.dir = null;
  state.fixed = null;
  state.loaded = false;
  state.pending.clear();
  state.verified.clear();
  state.loadedPath = null;
  state.file = null;
  state.savedAt = null;
  state.sizeBytes = null;
  state.detail = null;
  state.lastSignature = null;
  state.lastSaveAt = 0;
  state.lastSaveError = null;
  state.saving = null;
}
