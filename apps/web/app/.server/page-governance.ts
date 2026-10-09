import {
  type Governance,
  governance,
  governanceAtHead,
  governanceSplitApplies,
} from "./governance";
import { latestBlock } from "./rpc";

// Which governance a flow reads: JSON (/api/*) always governance() (a full read, at most 30 s
// old); pages governance at the head they read (governance.ts governanceAtHead: the constructor-
// only part kept, everything that changes read at that head), where the code it relies on is
// pinned (governanceSplitApplies), else governance() as JSON reads it.

/** Governance for a page (see above). */
export async function pageGovernance(): Promise<Governance> {
  let split = false;
  try {
    split = await governanceSplitApplies();
  } catch {
    split = false;
  }
  if (!split) return governance();
  return governanceAtHead(await latestBlock());
}

/** governance() for "strict" (JSON), pageGovernance() for "page". */
export function governanceFor(freshness: "strict" | "page"): Promise<Governance> {
  return freshness === "page" ? pageGovernance() : governance();
}
