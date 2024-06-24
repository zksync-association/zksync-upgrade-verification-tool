import type {NewZkSyncEraDiff} from "../new-zk-sync-era-diff";
import type {EraContractsRepo} from "../era-contracts-repo";
import CliTable from "cli-table3";

export class CheckReport {
  private diff: NewZkSyncEraDiff;
  private repo: EraContractsRepo;

  constructor(diff: NewZkSyncEraDiff, repo: EraContractsRepo) {
    this.diff = diff
    this.repo = repo
  }


  async format(): Promise<string> {
    const lines: string[] = []

    await this.addHeader(lines)

    return lines.join("\n")
  }

  private async addHeader(lines: string[]): Promise<void> {
    const title = "Upgrade metadata"
    lines.push(title)
    lines.push("=".repeat(title.length))
    lines.push("")

    const table = new CliTable({head: ["Name", "Value"], style: {compact: true}})
    const [currentVersion, proposedVersion] = this.diff.protocolVersion()
    table.push(["Current version", currentVersion])
    table.push(["Proposed version", proposedVersion])
    table.push(["Taking l2 contracts from", "https://github.com/matter-labs/era-contracts"])
    const gitSha = await this.repo.currentRef();
    const branch = await this.repo.currentBranch();
    const refValue = branch.map(b => `${b} (${gitSha})`)
      .unwrapOr(gitSha)
    table.push(["L2 contracts commit", refValue])

    lines.push(table.toString())
  }
}