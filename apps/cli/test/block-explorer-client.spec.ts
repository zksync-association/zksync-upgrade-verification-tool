import { BlockExplorerClient } from "../src/ethereum/block-explorer-client";
import { ExternalApiError } from "../src/lib/errors";
import { beforeEach, describe, expect, it } from "vitest";

describe("BlockExplorerClient", () => {
  describe("#getAbi", () => {
    describe("ok with a working api", () => {
      const subject = () =>
        new BlockExplorerClient("", "https://block-explorer-api.sepolia.zksync.dev/api");
      it("returns correct abi", async () => {
        const client = subject();
        const result = await client.getAbi("0x0000000000000000000000000000000000008002");
        const response = await fetch(
          "https://block-explorer-api.sepolia.zksync.dev/api?module=contract&action=getabi&address=0x0000000000000000000000000000000000008002"
        );
        const data = await response.json();
        const expected: Record<string, any>[] = JSON.parse((data as any).result);

        expect(result.raw.length).toEqual(expected.length);
        expect(result.raw).toEqual(expect.arrayContaining(expected));
      });

      it("returns error for a non existing address", async () => {
        const client = subject();
        await expect(client.getAbi("0xffffffffffffffffffffffffffffffffffffffff")).rejects.toThrow(
          ExternalApiError
        );
      });

      describe("when the abi was already requested once", () => {
        interface Ctx {
          client: BlockExplorerClient;
        }
        beforeEach<Ctx>(async (ctx) => {
          ctx.client = subject();
          await ctx.client.getAbi("0x0000000000000000000000000000000000008002");
        });

        it<Ctx>(
          "second call contract is fast",
          async ({ client }) => {
            await client.getAbi("0x0000000000000000000000000000000000008002");
          },
          { timeout: 1 }
        );
      });
    });

    describe("with a non existing api", () => {
      const subject = () =>
        new BlockExplorerClient(
          "",
          "https://block-explorer-api.sepolia.zksync.dev/does-not-exists"
        );

      it("throws errors", async () => {
        const client = subject();
        await expect(client.getAbi("0x0000000000000000000000000000000000008002")).rejects.toThrow(
          ExternalApiError
        );
      });
    });
  });

  describe("#isVerified", () => {
    const subject = () =>
      new BlockExplorerClient("", "https://block-explorer-api.sepolia.zksync.dev/api");

    it("returns true when the contract is actually verified", async () => {
      const client = subject();
      const res = await client.isVerified("0x0000000000000000000000000000000000008002");
      expect(res).toBe(true);
    });

    it("returns false when the contract does not exist", async () => {
      const client = subject();
      const res = await client.isVerified("0xffffffffffffffffffffffffffffffffffffffff");
      expect(res).toBe(false);
    });

    describe("when a wrong api", () => {
      const subject = () =>
        new BlockExplorerClient(
          "",
          "https://block-explorer-api.sepolia.zksync.dev/does-not-exists"
        );
      it("errors", async () => {
        const client = subject();
        await expect(
          client.isVerified("0x0000000000000000000000000000000000008002")
        ).rejects.toThrow();
      });
    });
  });

  describe("#getSourceCode", () => {
    const subject = () =>
      new BlockExplorerClient("", "https://block-explorer-api.mainnet.zksync.io/api");
    describe("with a valid api", () => {
      it("returns source code for a contract", async () => {
        const client = subject();
        const res = await client.getSourceCode("0x0000000000000000000000000000000000008002");
        const files = Object.keys(res.sources);
        expect(files.length).toEqual(30);
      });

      it('returns "contract.sol" for single file contracts', async () => {
        const client = subject();
        const res = await client.getSourceCode("0x0000000000000000000000000000000000000002");
        expect(Object.keys(res.sources)).toEqual(["contract.sol"]);
        expect(res.sources["contract.sol"]).toBeDefined();
      });

      describe("when the source code was already requested once", () => {
        interface Ctx {
          client: BlockExplorerClient;
        }
        beforeEach<Ctx>(async (ctx) => {
          ctx.client = subject();
          await ctx.client.getSourceCode("0x0000000000000000000000000000000000008002");
        });

        it<Ctx>(
          "second call contract is fast",
          async ({ client }) => {
            await client.getSourceCode("0x0000000000000000000000000000000000008002");
          },
          { timeout: 1 }
        );
      });
    });
  });

  describe(".forL1", () => {
    it("returns mainnet uri for mainnet", () => {
      const client = BlockExplorerClient.forL1("some api key", "mainnet");
      expect(client.baseUri).to.eql("https://api.etherscan.io/api");
    });

    it("returns mainnet uri for testnet", () => {
      const client = BlockExplorerClient.forL1("some api key", "sepolia");
      expect(client.baseUri).to.eql("https://api-sepolia.etherscan.io/api");
    });
  });

  describe(".forL2", () => {
    it("returns mainnet uri for mainnet", () => {
      const client = BlockExplorerClient.forL2("mainnet");
      expect(client.baseUri).to.eql("https://block-explorer-api.mainnet.zksync.io/api");
    });

    it("returns mainnet uri for testnet", () => {
      const client = BlockExplorerClient.forL2("sepolia");
      expect(client.baseUri).to.eql("https://block-explorer-api.sepolia.zksync.dev/api");
    });
  });
});
