import { emergencyListContent, freezeListContent, vetoListContent } from "@/.server/sync/content";
import { heldEmergencyList } from "@/.server/flows/emergency";
import { heldFreezeList } from "@/.server/flows/freeze";
import { heldVetoList } from "@/.server/flows/l2-veto";
import { pageGovernance } from "@/.server/page-governance";
import { readBodyAtMost } from "@/.server/request";
import { latestBlock } from "@/.server/rpc";
import { type SafeCheck, checkSafesNow } from "@/.server/safe/store";
import { pageSetOf, pageSetSafeCheck, reverifyPageSet } from "@/.server/signatures";
import { readAt } from "@/.server/sync/content-engine";
import { listSafeChecks, wakeSync } from "@/.server/sync/engine";
import { isOwnBeat, presence, requestInfo } from "@/.server/sync/presence";
import { currentRev, noteContent } from "@/.server/sync/revs";
import { type ActionFunctionArgs, json } from "@remix-run/node";
import type { Address } from "viem";

// "Fetch signatures" on an open set and "Check Safe now" on a Safe-fed list: reads the Safes behind
// it now at a request's priority, verifies the set again at the served head (or reads the list
// again) and answers with its revision. Only this app's own pages may ask; Safe is only read.

export type SafeCheckAnswer = {
  key: string;
  rev: string | null;
  checked: number;
  failed: number;
  check: SafeCheck | null;
};

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_BODY = 1_024;
const KEY = /^(?:set:[0-9a-f]{32}|list:emergency(?::all)?|list:freeze|list:vetoes)$/;

const refuse = (status: number, error: string) => json({ error }, { status, headers: NO_STORE });

const running = new Map<string, Promise<SafeCheckAnswer | null>>();

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") return refuse(405, "Checks are POSTed.");
  if (!isOwnBeat(requestInfo(request), new URL(request.url).origin))
    return refuse(403, "Checks come from this app's own pages, as JSON.");
  const text = await readBodyAtMost(request, MAX_BODY);
  if (text === null) return refuse(413, "Too large.");
  let key: unknown;
  try {
    key = (JSON.parse(text) as { key?: unknown } | null)?.key;
  } catch {
    return refuse(400, "Not a check.");
  }
  if (typeof key !== "string" || !KEY.test(key)) return refuse(400, "Not a check.");
  // Pressing the button is using the app: the engine follows the chain while it runs.
  presence().load([key]);
  wakeSync();
  let check = running.get(key);
  if (!check) {
    check = checkNow(key).finally(() => running.delete(key));
    running.set(key, check);
  }
  const answer = await check;
  if (!answer) return refuse(404, "Nothing on this page is known by that key. Reload the page.");
  return json(answer, { headers: NO_STORE });
}

async function checkNow(key: string): Promise<SafeCheckAnswer | null> {
  if (key.startsWith("set:")) {
    const set = pageSetOf(key);
    if (!set) return null;
    const { checked, failed } = await checkSafesNow(set.members);
    const verified = await reverifyPageSet(key);
    return {
      key,
      rev: verified?.watch?.rev ?? null,
      checked,
      failed: failed.length,
      check: pageSetSafeCheck(key),
    };
  }
  const gov = await pageGovernance();
  const safes: Address[] = key.startsWith("list:emergency")
    ? [
        ...gov.securityCouncil.members,
        ...gov.guardians.members,
        gov.emergencyUpgradeBoard.zkFoundation,
      ]
    : key === "list:freeze"
      ? gov.securityCouncil.members
      : gov.guardians.members;
  const { checked, failed } = await checkSafesNow(safes);
  const at = { head: (await latestBlock()).number };
  let rev = currentRev(key);
  // Lists built on governance are noted at the block governance was read at, if older.
  if (key.startsWith("list:emergency")) {
    const list = await heldEmergencyList({ allHistory: key.endsWith(":all") });
    if (list)
      rev = noteContent(
        key,
        readAt(at, list.governance),
        emergencyListContent(list.pending, list.executed)
      ).rev;
  } else if (key === "list:freeze") {
    const list = await heldFreezeList();
    if (list) rev = noteContent(key, readAt(at, list.governance), freezeListContent(list)).rev;
  } else {
    const list = await heldVetoList();
    if (list && list.vetoable.l2Error === null)
      rev = noteContent(key, at, vetoListContent(list.signed, list.vetoable)).rev;
  }
  return { key, rev, checked, failed: failed.length, check: listSafeChecks([key])[key] ?? null };
}
