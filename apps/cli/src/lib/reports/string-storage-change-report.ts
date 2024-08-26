import chalk from "chalk";
import type { StorageChanges } from "../storage/storage-changes.js";
import { StringStorageVisitor } from "./string-storage-visitor.js";

export class StringStorageChangeReport {
  lines: string[];
  private colored: boolean;
  private changes: StorageChanges;

  constructor(memoryMap: StorageChanges, colored = true) {
    this.lines = [];
    this.colored = colored;
    this.changes = memoryMap;
  }

  private bold(text: string): string {
    if (this.colored) {
      return chalk.bold(text);
    }
    return text;
  }

  async format(): Promise<string> {
    const changes = await this.changes.allChanges();
    const visitor = new StringStorageVisitor();
    const lines = [];

    for (const change of changes) {
      lines.push("--------------------------");
      lines.push(`name: ${this.bold(change.prop.name)}`);
      lines.push(`description: ${change.prop.description}`);
      lines.push("");
      lines.push(`before:${change.before.map((v) => v.accept(visitor)).unwrapOr("No content.")}`);
      lines.push("");
      lines.push(`after:${change.after.map((v) => v.accept(visitor)).unwrapOr("No content.")}`);
      lines.push("--------------------------");
    }

    return lines.join("\n");
  }
}
