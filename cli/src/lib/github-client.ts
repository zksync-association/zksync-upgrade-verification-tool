import { Octokit } from "@octokit/core";
import type { Sources } from "../schema";
import path from "node:path";
import { EraContractsRepo } from "./era-contracts-repo";

export class GithubClient {
  private octo: Octokit;
  ref: string;

  constructor(ref: string, apiKey?: string) {
    this.ref = ref;
    this.octo = apiKey ? new Octokit({ auth: apiKey }) : new Octokit();
  }

  async downloadFile(filePath: string): Promise<string> {
    const repo = await EraContractsRepo.default()
    await repo.init()

    return repo.readFile(filePath)
  }

  async downloadSystemContract(contractName: string): Promise<Sources> {
    return this.downloadContractInt(`system-contracts/contracts/${contractName}.sol`, {});
  }

  private async downloadContractInt(rootPath: string, partial: Sources): Promise<Sources> {
    if (partial[rootPath]) {
      return partial;
    }

    const dir = path.parse(rootPath).dir;
    const content = await this.downloadFile(rootPath);
    partial[rootPath] = { content };

    const deps = this.extractDeps(content);

    await Promise.all(
      deps.map(async (dep: string): Promise<void> => {
        const depPath = path.normalize(path.join(dir, dep));
        await this.downloadContractInt(depPath, partial);
      })
    );

    return partial;
  }

  private extractDeps(sourceCode: string) {
    const reg1 = /import.*["'](.+)["'];?/g;
    const matches = sourceCode.matchAll(reg1);

    const res: string[] = [];
    for (const match of matches) {
      res.push(match[1]);
    }

    return res;
  }

  async auth(): Promise<Record<string, string>> {
    return (await this.octo.auth()) as Record<string, string>;
  }
}
