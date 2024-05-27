import path from "node:path";
import {
  commonJsonSchema,
  type FacetsJson, facetsSchema,
  type L2UpgradeJson, l2UpgradeSchema, transactionsSchema, type UpgradeManifest,
} from "../schema";
import type { Network } from "./constants";
import { MalformedUpgrade, MissingNetwork, NotAnUpgradeDir } from "./errors.js";
import { UpgradeChanges } from "./upgrade-changes";
import type { FileSystem } from "./file-system";
import { z, type ZodType } from "zod";

const POSSIBLE_DIRS_PER_NETWORK = {
  mainnet: ["mainnet", "mainnet2"],
  sepolia: ["testnet-sepolia", "testnet"]
}

export class UpgradeImporter {
  private fs: FileSystem;

  constructor(fs: FileSystem) {
    this.fs = fs
  }

  private possibleDirNamesFor(network: Network): string[] {
    return POSSIBLE_DIRS_PER_NETWORK[network]
  }

  private async findNetworkDir(baseDir: string, network: Network): Promise<string> {
    const possibleNetworkDirs = this.possibleDirNamesFor(network);
    for (const possibleDir of possibleNetworkDirs) {
      const fullNetworkDir = path.join(baseDir, possibleDir);
      if (await this.fs.directoryExists(fullNetworkDir)) {
        return fullNetworkDir
      }
    }
    throw new MissingNetwork(baseDir, network);
  }

  async readFromFiles(upgradeDirectory: string, network: Network): Promise<UpgradeChanges> {
    const targetDir = upgradeDirectory;
    const networkDir = await this.findNetworkDir(targetDir, network)

    await this.fs.assertDirectoryExists(targetDir, upgradeDirectory);
    await this.fs.assertDirectoryExists(targetDir, networkDir);

    const common = await this.readMandatoryFile(path.join(targetDir, 'common.json'), commonJsonSchema, new NotAnUpgradeDir(upgradeDirectory))
    const transactions = await this.readMandatoryFile(path.join(networkDir, 'transactions.json'), transactionsSchema, new MalformedUpgrade("Missing transactions.json"))

    const facets = await this.readOptionalFile(path.join(networkDir, 'facets.json'), facetsSchema)
    const l2Upgrade = await this.readOptionalFile(path.join(networkDir, 'l2Upgrade.json'), l2UpgradeSchema)

    return UpgradeChanges.fromFiles(
      common,
      transactions,
      facets,
      l2Upgrade
    )
  }

  private async readMandatoryFile<T extends ZodType>(filePath: string, parser: T, ifMissing: Error): Promise<z.infer<typeof parser>> {
    const res = await this.readOptionalFile(filePath, parser)
    if (res === undefined) {
      return ifMissing
    }
    return res
  }

  private async readOptionalFile<T extends ZodType>(filePath: string, parser: T): Promise<z.infer<typeof parser> | undefined> {
    const fileContent: string | undefined = await this.fs.readFile(filePath)
      .then(
        (buf) => buf.toString(),
        () => undefined
      )

    if (fileContent === undefined) {
      return undefined
    }

    let json: any

    try {
      json = JSON.parse(fileContent)
   } catch (e) {
      throw new MalformedUpgrade(`"${filePath}" expected to be a json but it's not.`)
    }

    try {
      return parser.parse(json)
    } catch (e) {
      throw new MalformedUpgrade(`"${filePath}" does not follow expected schema.`)
    }
  }
}