import type { Sources } from "../schema";
import path from "node:path";
import { EraContractsRepo } from "./era-contracts-repo";
import { GitError } from "simple-git";

export class GithubClient {
  private contractsRepo: EraContractsRepo;
  private ref: string;

  constructor(contractsRepo: EraContractsRepo, ref: string) {
    this.ref = ref;
    this.contractsRepo = contractsRepo;
  }

  static async create(ref: string): Promise<GithubClient> {
    const repo = await EraContractsRepo.default();
    return new GithubClient(repo, ref);
  }

  async downloadFile(filePath: string): Promise<string> {
    try {
      return await this.contractsRepo.readFile(filePath, this.ref);
    } catch (e) {
      if (e instanceof GitError) {
        return "Content not found";
      }
      throw e;
    }
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
    return { auth: "no-auth" };
  }
}
