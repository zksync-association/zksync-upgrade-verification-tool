import { type SimpleGit, simpleGit } from "simple-git";
import { cacheDir, directoryExists } from "./fs-utils.js";
import path from "node:path";
import fs from "node:fs/promises";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { compiledArtifactParser } from "./schema/compiled.js";
import { utils } from "zksync-ethers";
import { type SystemContractHashes, systemContractHashesParser } from "./schema/github-schemas.js";
import { Option } from "nochoices";
import type { Sources } from "../ethereum/contract-data";

const execPromise = promisify(exec);

export interface ContractsRepo {
  byteCodeHashFor(systemContractName: string): Promise<Option<string>>;

  currentRef(): Promise<string>;

  currentBranch(): Promise<Option<string>>;
}

export class GitContractsRepo implements ContractsRepo {
  repoPath: string;
  git: SimpleGit;
  private _currentRef: Option<Promise<string>>;

  constructor(repoPath: string) {
    this.repoPath = repoPath;
    this.git = simpleGit({
      baseDir: repoPath,
    });
    this._currentRef = Option.None();
  }

  static async default(): Promise<GitContractsRepo> {
    const base = await cacheDir();
    const repoDir = path.join(base, "era-contracts-repo");
    await fs.mkdir(repoDir, { recursive: true });
    return new GitContractsRepo(repoDir);
  }

  async init(): Promise<void> {
    if (await directoryExists(path.join(this.repoPath, ".git"))) {
      await this.git.fetch();
    } else {
      await this.git.clone("https://github.com/matter-labs/era-contracts.git", ".");
    }
  }

  async readFile(subPath: string, ref = "HEAD"): Promise<string> {
    if (ref === "HEAD") {
      return fs.readFile(path.join(this.repoPath, subPath)).then((buf) => buf.toString());
    }
    return this.git.show(`${ref}:${subPath}`);
  }

  async setRevision(ref: string): Promise<void> {
    this._currentRef.insert(Promise.resolve(ref));
    await this.git.fetch();
    await this.git.checkout(ref, ["--force"]);
    const currentBranch = await this.currentBranch();
    if (currentBranch.isSome()) {
      await this.git.pull();
    }
  }

  async compileSystemContracts(): Promise<void> {
    await execPromise("yarn", { cwd: this.repoPath });
    const systemContractsDir = path.join(this.repoPath, "system-contracts");
    await execPromise("yarn clean", { cwd: systemContractsDir });
    await execPromise("yarn build", { cwd: systemContractsDir });
  }

  async systemContractHashes(ref = "HEAD"): Promise<SystemContractHashes> {
    const hashesRaw = await this.git.show(`${ref}:system-contracts/SystemContractsHashes.json`);
    return systemContractHashesParser.parse(JSON.parse(hashesRaw));
  }

  async byteCodeFor(systemContractName: string): Promise<Option<Buffer>> {
    const hashes = await this.systemContractHashes();
    const hashData = hashes.find((d) => d.contractName === systemContractName);
    if (!hashData) {
      return Option.None();
    }

    return Option.Some(await this.extractBytecodeFromFile(hashData.bytecodePath));
  }

  async byteCodeHashFor(systemContractName: string): Promise<Option<string>> {
    const maybeByteCode = await this.byteCodeFor(systemContractName);
    return maybeByteCode.map((byteCode) => {
      const rawHash = utils.hashBytecode(byteCode);
      const hex = Buffer.from(rawHash).toString("hex");
      return `0x${hex}`;
    });
  }

  private async extractBytecodeFromFile(filePath: string): Promise<Buffer> {
    const contractArtifactoryFile = path.join(this.repoPath, "system-contracts", filePath);
    if (contractArtifactoryFile.endsWith(".json")) {
      const content = await fs.readFile(contractArtifactoryFile);
      const json = JSON.parse(content.toString());
      const parsed = compiledArtifactParser.parse(json);
      return Buffer.from(parsed.bytecode.substring(2), "hex");
    }

    if (contractArtifactoryFile.endsWith(".yul.zbin")) {
      return await fs.readFile(contractArtifactoryFile);
    }

    throw new Error(`Unknown bytecode file type: ${contractArtifactoryFile}`);
  }

  async downloadSystemContract(contractName: string): Promise<Sources> {
    const json = await this.systemContractHashes();
    const found = json.find((json) => json.contractName === contractName);
    if (!found) {
      throw new Error(`Unknown contract: ${contractName}`);
    }
    return this.downloadContractInt(path.join("system-contracts", found.sourceCodePath), {});
  }

  private async downloadContractInt(rootPath: string, partial: Sources): Promise<Sources> {
    if (partial[rootPath]) {
      return partial;
    }

    const dir = path.parse(rootPath).dir;
    const content = await this.readFile(rootPath);
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
      if (!match[1]) {
        throw new Error(`Invalid import statement: ${match[1]}`);
      }
      res.push(match[1]);
    }

    return res;
  }

  async currentRef(): Promise<string> {
    return this._currentRef.getOrInsert(this.git.revparse(["--short", "HEAD"]));
  }

  async currentBranch(): Promise<Option<string>> {
    const branch = await this.git.branch(["--show-current"]);
    return Option.fromNullable(branch.current).filter((branchName) => branchName.length > 0);
  }
}
