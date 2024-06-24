import { describe, it, expect } from "vitest";
import {CheckReport} from "../src/lib/reports/check-report";
import {NewZkSyncEraDiff} from "../src/lib/new-zk-sync-era-diff";
import {CurrentZksyncEraState} from "../src/lib/current-zksync-era-state";
import {SystemContractList} from "../src/lib/system-contract-providers";
import {EraContractsRepo} from "../src/lib/era-contracts-repo";

describe('CheckReport', () => {
  it("works", async () => {
    const current = new CurrentZksyncEraState({
      protocolVersion: "0x000000000000000000000000000000000000000000000000000000000000000f"
    }, [], new SystemContractList([]))
    const proposed = new CurrentZksyncEraState({
      protocolVersion: "0x0000000000000000000000000000000000000000000000000000001800000001"
    }, [], new SystemContractList([]))
    const diff = new NewZkSyncEraDiff(current, proposed, [])
    const repo = await EraContractsRepo.default()
    const report = new CheckReport(diff, repo);

    console.log(await report.format())
  })
});