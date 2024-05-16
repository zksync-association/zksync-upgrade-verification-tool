import { type SimpleGit, simpleGit } from 'simple-git'
import { cacheDir, directoryExists } from "./fs-utils";
import path from "node:path";
import fs from "node:fs/promises";

export class EraContractsRepo {
  repoPath: string
  git: SimpleGit

  constructor(repoPath: string) {
    this.repoPath = repoPath
    this.git = simpleGit({
      baseDir: repoPath
    })
  }

  static async default(): Promise<EraContractsRepo> {
    const base = cacheDir()
    const repoDir = path.join(base, 'era-contracts-repo')
    await fs.mkdir( repoDir, { recursive: true } )
    return new EraContractsRepo(repoDir)
  }

  async init(): Promise<void> {
    if (await directoryExists(path.join(this.repoPath, '.git') )) {
      await this.git.fetch()
    } else {
      await this.git.clone('https://github.com/matter-labs/era-contracts.git', '.')
    }
  }

  async readFile(subPath: string, ref: string): Promise<string> {
    return this.git.show(`${ref}:${subPath}`)
  }
}