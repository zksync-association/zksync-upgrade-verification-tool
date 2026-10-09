import { env } from "@config/env.server";
import { type Hex, TransactionReceiptNotFoundError } from "viem";
import { linkStore } from "../cache";
import { l1, network, safeBlockNumber } from "../rpc";

// A transaction's receipt as its page shows it (`tx:<hash>` key): read by the page's loader, and
// by the sync engine once per head while the page is on screen, until the receipt's block is final
// (at or below the finality boundary F). A receipt found in a final block is kept for good (never
// read again). One found above F is read again at each head: a reorg can drop the transaction or
// put it in another block. A read that fails changes nothing; a read that no longer finds a
// receipt found before (a reorg, or a backend behind the one that found it) makes the page say it
// could not read it, never "not mined" and never the old receipt as current.

/** A transaction's receipt as its page shows it (`tx:<hash>`); null until it is mined. */
export type ReceiptView = {
  status: "success" | "reverted";
  blockNumber: string;
  from: string;
  to: string | null;
  fee: string;
} | null;

/**
 * A receipt found before, above the finality boundary, is not found now: a reorg dropped the
 * transaction, or the node asked is behind the one that found it. Never "not mined".
 */
export class ReceiptLost extends Error {
  override name = "ReceiptLost";
}

// Receipts found (by lower-case hash), and whether their block is final: at most this many, the
// oldest found go first.
const MINED_LIMIT = 64;
type Found = { view: NonNullable<ReceiptView>; final: boolean };
const mined = new Map<string, Found>();

/**
 * The receipt of `hash` as its page shows it: the one found before in a final block, else read
 * through the app's RPC now; null when the node has none (not mined yet). Rejects when the node
 * could not be asked (an RPC error is never "not mined"), and with ReceiptLost when a receipt
 * found before above the finality boundary is not found now.
 */
export async function receiptView(hash: Hex): Promise<ReceiptView> {
  const key = hash.toLowerCase();
  const found = mined.get(key);
  if (found?.final) return found.view;
  const receipt = await l1.getTransactionReceipt({ hash }).then(
    (receipt) => ({
      status: receipt.status,
      blockNumber: receipt.blockNumber.toString(),
      from: receipt.from,
      to: receipt.to,
      fee: (receipt.gasUsed * receipt.effectiveGasPrice).toString(),
    }),
    (error: unknown) => {
      if (error instanceof TransactionReceiptNotFoundError) return null;
      throw error;
    }
  );
  if (receipt) {
    // Final once its block is at or below F (unknown F: not yet, read again next time).
    const safe = await safeBlockNumber().catch(() => null);
    mined.delete(key);
    mined.set(key, { view: receipt, final: safe !== null && BigInt(receipt.blockNumber) <= safe });
    while (mined.size > MINED_LIMIT) mined.delete(mined.keys().next().value as string);
    return receipt;
  }
  if (found)
    throw new ReceiptLost(
      `The receipt found in block ${found.view.blockNumber} is not found now (a reorg, or a node behind the one that found it)`
    );
  return null;
}

/**
 * The page's receipt, or that it could not be read (`unread`): what its loader sends and what its
 * revision is a digest of (the engine notes nothing when its own read fails).
 */
export type ReceiptAnswer = { receipt: ReceiptView; unread: boolean };

/** receiptView for the page's loader: never rejects (an RPC failure is `unread`, not "not mined"). */
export function pageReceipt(hash: Hex): Promise<ReceiptAnswer> {
  return receiptView(hash).then(
    (receipt) => ({ receipt, unread: false }),
    () => ({ receipt: null, unread: true })
  );
}

/** What a `tx:` key's revision is a digest of (the loader's and the engine's alike). */
export const receiptContent = (answer: ReceiptAnswer) =>
  answer.unread ? { unread: true } : answer.receipt;

/**
 * Whether the page's receipt is read again at each new block while it is on screen: the sync
 * engine follows the chain (not on a dev node, not with SYNC_MODE=off). Never rejects.
 */
export async function receiptFollowed(): Promise<boolean> {
  if (env.SYNC_MODE === "off") return false;
  return network().then(
    (net) => !net.isDevNode,
    () => false
  );
}

/** Forgets the receipts found (tests). */
export function resetReceipts() {
  mined.clear();
}

// A settings change (another RPC, maybe another chain) and a dev node's refresh drop them.
linkStore("receipt:", (prefix) => {
  if (prefix === null) mined.clear();
});
