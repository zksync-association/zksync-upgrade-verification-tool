import { describe, it, expect, beforeEach } from "vitest";
import { UpgradeImporter } from "../src";
import { FileSystem } from "../src";
import path from "node:path";
import { MalformedUpgrade } from "../src/lib/errors";
import { z } from "zod";

class TestFS extends FileSystem {
  private registered: Map<string, string>;

  constructor() {
    super();
    this.registered = new Map();
  }

  register(filePath: string[], content: string) {
    this.registered.set(path.join(...filePath), content);
  }

  async readFile(path: string): Promise<Buffer> {
    const content = this.registered.get(path);
    if (!content) {
      throw new Error(`File not found: ${path}`);
    }
    return Buffer.from(content);
  }

  async writeFile(_path: string, _content: Buffer): Promise<void> {}

  async directoryExists(dirPath: string): Promise<boolean> {
    return [...this.registered.keys()].some((key) => key.startsWith(dirPath));
  }
}

function repeated(n: number, times: number): string {
  return `0x${Buffer.from([n]).toString("hex").repeat(times)}`;
}

interface Ctx {
  fs: TestFS;
  importer: UpgradeImporter;
}

function registerFullUpgrade(baseDir: string, fs: TestFS) {
  fs.register(
    [baseDir, "common.json"],
    JSON.stringify({ name: "test", creationTimestamp: 1, protocolVersion: "25" })
  );

  const facetAddr = repeated(7, 20);
  fs.register(
    [baseDir, "mainnet", "transactions.json"],
    JSON.stringify({
      proposeUpgradeTx: {
        bootloaderHash: repeated(1, 32),
        defaultAccountHash: repeated(2, 32),
        verifier: repeated(3, 20),
        verifierParams: {
          recursionNodeLevelVkHash: repeated(4, 32),
          recursionLeafLevelVkHash: repeated(5, 32),
          recursionCircuitsSetVksHash: repeated(6, 32),
        },
      },
      transparentUpgrade: {
        facetCuts: [
          {
            facet: facetAddr,
            selectors: [repeated(8, 4)],
            action: 0,
            isFreezable: false,
          },
        ],
      },
      governanceOperation: {
        calls: [{ target: "0x1", data: "0x2" }],
      },
    })
  );
  fs.register(
    [baseDir, "mainnet", "facets.json"],
    JSON.stringify({
      SomeFacet: {
        address: facetAddr,
        txHash: repeated(9, 32),
      },
    })
  );

  fs.register(
    [baseDir, "mainnet", "l2Upgrade.json"],
    JSON.stringify({
      systemContracts: [
        {
          name: "SomeSystemContract",
          bytecodeHashes: [repeated(10, 32)],
          address: repeated(11, 20),
        },
      ],
    })
  );
}

describe("UpgradeImporter", () => {
  beforeEach<Ctx>((ctx) => {
    ctx.fs = new TestFS();
    ctx.importer = new UpgradeImporter(ctx.fs);
  });

  describe("when the uprade is simple", () => {
    const baseDir = "base";

    function repeated(n: number, times: number): string {
      return `0x${Buffer.from([n]).toString("hex").repeat(times)}`;
    }

    beforeEach<Ctx>(({ fs }) => {
      fs.register(
        [baseDir, "common.json"],
        JSON.stringify({ name: "test", creationTimestamp: 1, protocolVersion: "25" })
      );
      fs.register(
        [baseDir, "mainnet", "transactions.json"],
        JSON.stringify({
          proposeUpgradeTx: {
            bootloaderHash: repeated(1, 32),
            defaultAccountHash: repeated(2, 32),
            verifier: repeated(3, 20),
            verifierParams: {
              recursionNodeLevelVkHash: repeated(4, 32),
              recursionLeafLevelVkHash: repeated(5, 32),
              recursionCircuitsSetVksHash: repeated(6, 32),
            },
          },
          transparentUpgrade: {
            facetCuts: [],
          },
          governanceOperation: {
            calls: [{ target: "0x1", data: "0x2" }],
          },
        })
      );
    });

    it<Ctx>("parse the data", async ({ importer }) => {
      const upgrades = await importer.readFromFiles(baseDir, "mainnet");
      expect(upgrades.facets).to.eql([]);
      expect(upgrades.aaBytecodeHash).to.eql(repeated(2, 32));
      expect(upgrades.systemContractChanges).to.eql([]);
      expect(upgrades.verifier.address).to.eql(repeated(3, 20));
      expect(upgrades.verifier.recursionNodeLevelVkHash).to.eql(repeated(4, 32));
      expect(upgrades.verifier.recursionLeafLevelVkHash).to.eql(repeated(5, 32));
      expect(upgrades.verifier.recursionCircuitsSetVksHash).to.eql(repeated(6, 32));
    });
  });

  describe("full upgrade", () => {
    const baseDir = "base";

    beforeEach<Ctx>(({ fs }) => {
      registerFullUpgrade(baseDir, fs);
    });

    it<Ctx>("adds new facets in upgrades", async ({ importer }) => {
      const upgrades = await importer.readFromFiles(baseDir, "mainnet");
      expect(upgrades.facets).to.eql([
        {
          name: "SomeFacet",
          address: repeated(7, 20),
          selectors: [repeated(8, 4)],
        },
      ]);
    });

    it<Ctx>("adds new system contracts in upgrade", async ({ importer }) => {
      const upgrades = await importer.readFromFiles(baseDir, "mainnet");
      expect(upgrades.systemContractChanges).to.eql([
        {
          name: "SomeSystemContract",
          codeHash: repeated(10, 32),
          address: repeated(11, 20),
        },
      ]);
    });
  });

  describe("when the common.js file is malformed", () => {
    const baseDir = "base";

    beforeEach<Ctx>(({ fs }) => {
      registerFullUpgrade(baseDir, fs);
      // missing "name"
      fs.register(
        [baseDir, "common.json"],
        JSON.stringify({ creationTimestamp: 1, protocolVersion: "25" })
      );
    });

    it<Ctx>("fails with proper error", async ({ importer }) => {
      await expect(importer.readFromFiles(baseDir, "mainnet")).rejects.toThrow(MalformedUpgrade);
    });
  });

  describe("when the transactions.js file is malformed", () => {
    const baseDir = "base";

    beforeEach<Ctx>(({ fs }) => {
      registerFullUpgrade(baseDir, fs);
      // missing "proposeUpgradeTx"
      fs.register(
        [baseDir, "mainnet", "transactions.json"],
        JSON.stringify({
          transparentUpgrade: {
            facetCuts: [
              {
                facet: repeated(7, 20),
                selectors: [repeated(8, 4)],
                action: 0,
                isFreezable: false,
              },
            ],
          },
        })
      );
    });

    it<Ctx>("fails with proper error", async ({ importer }) => {
      await expect(importer.readFromFiles(baseDir, "mainnet")).rejects.toThrow(MalformedUpgrade);
    });
  });

  describe("when the facets.js file is malformed", () => {
    const baseDir = "base";

    beforeEach<Ctx>(({ fs }) => {
      registerFullUpgrade(baseDir, fs);
      // missing "SomeFacet.address"
      fs.register(
        [baseDir, "mainnet", "facets.json"],
        JSON.stringify({
          SomeFacet: {
            txHash: repeated(9, 32),
          },
        })
      );
    });

    it<Ctx>("fails with propper error", async ({ importer }) => {
      await expect(importer.readFromFiles(baseDir, "mainnet")).rejects.toThrow(MalformedUpgrade);
    });
  });
});
