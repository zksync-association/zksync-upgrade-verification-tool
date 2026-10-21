import {
  type Governance,
  governance,
  governanceAtHead,
  governanceSplitApplies,
} from "./governance";
import { latestBlock } from "./rpc";

// JSON (/api/*) always reads governance(); pages read governance at their head where the code it
// relies on is pinned (governanceSplitApplies).

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

export function governanceFor(freshness: "strict" | "page"): Promise<Governance> {
  return freshness === "page" ? pageGovernance() : governance();
}
