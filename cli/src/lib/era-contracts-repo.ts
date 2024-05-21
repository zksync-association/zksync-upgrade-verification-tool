import { type SimpleGit, simpleGit } from "simple-git";
import { cacheDir, directoryExists } from "./fs-utils";
import path from "node:path";
import fs from "node:fs/promises";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { compiledArtifactParser } from "../schema/compiled";
import { utils } from "zksync-ethers";
import { systemContractHashesSchema } from "../schema/github-schemas";

const execPromise = promisify(exec)

export class EraContractsRepo {
  repoPath: string;
  git: SimpleGit;

  constructor(repoPath: string) {
    this.repoPath = repoPath;
    this.git = simpleGit({
      baseDir: repoPath,
    });
  }

  static async default(): Promise<EraContractsRepo> {
    const base = cacheDir();
    const repoDir = path.join(base, "era-contracts-repo");
    await fs.mkdir(repoDir, { recursive: true });
    return new EraContractsRepo(repoDir);
  }

  async init(): Promise<void> {
    if (await directoryExists(path.join(this.repoPath, ".git"))) {
      await this.git.fetch();
    } else {
      await this.git.clone("https://github.com/matter-labs/era-contracts.git", ".");
    }
  }

  async readFile(subPath: string, ref: string): Promise<string> {
    return this.git.show(`${ref}:${subPath}`);
  }

  async setRevision(ref: string):Promise<void> {
    await this.git.checkout(ref, ['--force'])
  }

  async compile(): Promise<void> {
    await execPromise(`yarn`, { cwd: this.repoPath })
    const systemContractsDir = `${this.repoPath}/system-contracts`;
    await execPromise(`yarn clean`, { cwd: systemContractsDir })
    await execPromise(`yarn build`, { cwd: systemContractsDir })
  }

  async byteCodeFor(systemContractName: string): Promise<Buffer> {
    const hashesRaw = await this.git.show("HEAD:system-contracts/SystemContractsHashes.json")
    const hashes = systemContractHashesSchema.parse(JSON.parse(hashesRaw))

    const hashData = hashes.find(d => d.contractName === systemContractName)
    if (!hashData) {
      throw new Error(`Unknown contract: ${systemContractName}`)
    }

    const contractArtifactoryFile = path.join(this.repoPath, "system-contracts", hashData.bytecodePath)

    if (contractArtifactoryFile.endsWith('.json')) {
      const content = await fs.readFile(contractArtifactoryFile)
      const json = JSON.parse(content.toString())
      const parsed = compiledArtifactParser.parse(json)
      return Buffer.from(parsed.bytecode.substring(2), 'hex')
    } else if (contractArtifactoryFile.endsWith(".yul.zbin")) {
      return await fs.readFile(contractArtifactoryFile)
    } else {
      throw new Error(`Unknown bytecode file type: ${contractArtifactoryFile}`)
    }
  }

  async byteCodeHashFor(systemContractName: string): Promise<string> {
    const byteCode = await this.byteCodeFor(systemContractName)
    const rawHash = utils.hashBytecode(byteCode);
    const hex = Buffer.from(rawHash).toString('hex');
    return `0x${hex}`
  }
}
