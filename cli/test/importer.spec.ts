import { describe, it, expect, beforeEach } from "vitest";
import { UpgradeImporter } from "../src/lib";
import { FileSystem } from "../src/lib/file-system";
import path from 'node:path'

class TestFS extends FileSystem {
  private registered: Map<string, string>

  constructor() {
    super()
    this.registered = new Map()
  }

  register(filePath: string[], content: string) {
    this.registered.set(
      path.join(...filePath),
      content
    )
  }


  async readFile(path: string): Promise<Buffer> {
    const content = this.registered.get(path)
    if (!content) {
      throw new Error(`File not found: ${path}`)
    }
    return Buffer.from(content);
  }

  async writeFile(_path: string, _content: Buffer): Promise<void> {

  }

  async directoryExists(dirPath: string): Promise<boolean> {
    return [...this.registered.keys()].some(key => key.startsWith(dirPath))
  }

  // async assertDirectoryExists(path: string, originalPath?: string): Promise<void> {
  //   if (!this.as)
  // }
}

interface Ctx {
  fs: TestFS,
  importer: UpgradeImporter
}

describe('UpgradeImporter', () => {
  beforeEach<Ctx>((ctx) => {
    ctx.fs = new TestFS()
    ctx.importer = new UpgradeImporter(ctx.fs)
  })


  describe('when the uprade is simple', () => {
    const baseDir = 'base'

    function repeated(n: number, times: number): string {
      return `0x${Buffer.from([n]).toString('hex').repeat(times)}`
    }

    beforeEach<Ctx>(({ fs }) => {
      fs.register([baseDir, 'common.json'], JSON.stringify(
        { name: "test", creationTimestamp: 1, protocolVersion: "25" }
      ))
      fs.register([baseDir, 'mainnet', 'transactions.json'], JSON.stringify({
        proposeUpgradeTx: {
          bootloaderHash: repeated(1, 32),
          defaultAccountHash: repeated(2, 32),
          verifier: repeated(3, 20),
          verifierParams: {
            recursionNodeLevelVkHash: repeated(4, 32),
            recursionLeafLevelVkHash: repeated(5, 32),
            recursionCircuitsSetVksHash: repeated(6, 32)
          },
        },
        transparentUpgrade: {
          facetCuts: []
        }
      }))
    })

    it<Ctx>('returns the simplest upgrade', async ({ importer }) => {
      const upgrades = await importer.readFromFiles(baseDir, "mainnet")
      expect(upgrades.facets).to.eql([])
    })
  })

})