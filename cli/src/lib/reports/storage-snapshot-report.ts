import type { StorageSnapshot } from "../storage/snapshot/storage-snapshot";
import type { ContractField } from "../storage/contractField";
import { StringStorageVisitor } from "./string-storage-visitor";

export class SnapshotReport {
  private snapshot: StorageSnapshot;
  private props: ContractField[];

  constructor(snapshot: StorageSnapshot, props: ContractField[]) {
    this.snapshot = snapshot;
    this.props = props;
  }

  async format(): Promise<string> {
    const lines: string[] = [];
    const visitor = new StringStorageVisitor();
    for (const prop of this.props) {
      const extracted = await prop.extract(this.snapshot);
      extracted.ifSome((value) => {
        lines.push("----------");
        lines.push(`name: ${prop.name}`);
        lines.push(`description: ${prop.description}\n`);

        lines.push(`value:${value.accept(visitor)}`);
        lines.push("----------");
      });
    }

    return lines.join("\n");
  }
}
