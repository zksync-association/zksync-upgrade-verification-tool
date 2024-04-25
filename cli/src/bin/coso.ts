import {Octokit} from '@octokit/core'
import * as console from "node:console";
import z from "zod";
import path from "node:path";

const octo = new Octokit({
  auth: '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'
})

const githubContentParser = z.object({
  data: z.object({
    content: z.string()
  })
})

async function downloadFile(path: string): Promise<string> {
  const rawResponse = await octo.request('GET /repos/{owner}/{repo}/contents/{path}{?ref}', {
    owner: "matter-labs",
    repo: "era-contracts",
    path,
    ref: "main",
    headers: {
      'X-GitHub-Api-Version': '2022-11-28'
    }
  })

  const parsed = githubContentParser.parse(rawResponse)

  return Buffer.from(parsed.data.content, 'base64').toString('utf-8')
}

function extractDeps(sourceCode: string): string[] {
  const reg = /import.*from\s+["'](.+)["'];?/g
  const matches = sourceCode.matchAll(reg)

  const res: string[] = []
  for(const match of matches) {
    res.push(match[1])
  }

  return res
}

async function downloadContract(rootPath: string, partial: Record<string, string>): Promise<Record<string, string>> {
  if (partial[rootPath]) {
    return partial
  }

  const dir = path.parse(rootPath).dir
  const content = await downloadFile(rootPath)
  partial[rootPath] = content

  const deps = extractDeps(content)

  for (const dep of deps) {
    const depPath = path.normalize(path.join(dir, dep))
    await downloadContract(depPath, partial)
  }

  return partial
}

const content = await downloadContract("system-contracts/contracts/NonceHolder.sol", {})
const keys = Object.keys(content)
console.log(keys)
console.log(content[keys[0]])
