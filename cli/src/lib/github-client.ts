import {Octokit} from "@octokit/core";
import type {Sources} from "../schema";
import path from "node:path";
import {githubContentParser} from "../schema/github-schemas.js";

export class GithubClient {
  private octo: Octokit
  private cache: Map<string, string>

  constructor(apiKey?: string) {
    this.octo = apiKey
      ? new Octokit({auth: apiKey})
      : new Octokit()
    this.cache = new Map()
  }

  async downloadFile(filePath: string, ref: string): Promise<string> {
    const cacheValue = this.cache.get(filePath)
    if (cacheValue !== undefined) {
      return cacheValue
    }

    try {
      const rawResponse = await this.octo.request('GET /repos/{owner}/{repo}/contents/{path}{?ref}', {
        owner: "matter-labs",
        repo: "era-contracts",
        path: filePath,
        ref,
        headers: {
          'X-GitHub-Api-Version': '2022-11-28'
        }
      })

      const parsed = githubContentParser.parse(rawResponse)

      const fileContent = Buffer.from(parsed.data.content, 'base64').toString('utf-8');
      this.cache.set(filePath, fileContent)
      return fileContent
    } catch (e) {
      const error = e as any
      if (error.status && error.status === 404) {
        const fileContent = 'Content not found';
        this.cache.set(filePath, fileContent)
        return fileContent
      }
      throw e
    }
  }

  async downloadContract(contractName: string, ref: string): Promise<Sources> {
    return this.downloadContractInt(`system-contracts/contracts/${contractName}.sol`, ref, {})
  }

  private async downloadContractInt(
    rootPath: string,
    ref: string,
    partial: Sources
  ): Promise<Sources> {
    if (partial[rootPath]) {
      return partial
    }

    const dir = path.parse(rootPath).dir
    const content = await this.downloadFile(rootPath, ref)
    partial[rootPath] = {content}

    const deps = this.extractDeps(content)

    await Promise.all(deps.map(async (dep: string): Promise<void> => {
      const depPath = path.normalize(path.join(dir, dep))
      await this.downloadContractInt(depPath, ref, partial)
    }))

    return partial
  }

  private extractDeps(sourceCode: string) {
    const reg1 = /import.*["'](.+)["'];?/g
    const matches = sourceCode.matchAll(reg1)

    const res: string[] = []
    for (const match of matches) {
      res.push(match[1])
    }

    return res
  }
}