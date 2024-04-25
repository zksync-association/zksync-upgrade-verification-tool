import {Octokit} from '@octokit/core'
import z from "zod";
import path from "node:path";

const githubContentParser = z.object({
  data: z.object({
    content: z.string()
  })
})

async function downloadFile(octo: Octokit, path: string): Promise<string> {
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
  for (const match of matches) {
    res.push(match[1])
  }

  return res
}

export async function downloadContract(
  octo: Octokit,
  rootPath: string,
  partial: Record<string, { content: string }>
): Promise<Record<string, { content: string }>> {
  if (partial[rootPath]) {
    return partial
  }

  const dir = path.parse(rootPath).dir
  const content = await downloadFile(octo, rootPath)
  partial[rootPath] = {content}

  const deps = extractDeps(content)

  for (const dep of deps) {
    const depPath = path.normalize(path.join(dir, dep))
    await downloadContract(octo, depPath, partial)
  }

  return partial
}
