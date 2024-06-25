import type {ContractsRepo} from "../../src/lib/git-contracts-repo";
import {Option} from "nochoices";

export class TestContractRepo implements ContractsRepo {
  private gitsha: string;
  private branch: Option<string>;
  private bytecodeHashes: Map<string, string>;

  constructor(gitsha: string, branch: Option<string>, hashes: Record<string, string>) {
    this.gitsha = gitsha
    this.branch = branch
    this.bytecodeHashes = new Map([...Object.entries(hashes)])
  }

  addHash(name: string, hash: string): void {
    this.bytecodeHashes.set(name, hash)
  }

  async byteCodeHashFor(systemContractName: string): Promise<Option<string>> {
    const hash = this.bytecodeHashes.get(systemContractName);
    return Option.fromNullable(hash);
  }

  async currentBranch(): Promise<Option<string>> {
    return this.branch;
  }

  async currentRef(): Promise<string> {
    return this.gitsha;
  }

}