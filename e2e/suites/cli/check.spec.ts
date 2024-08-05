import { describe, expect, it } from "vitest";
import "dotenv/config";
import { execAsync, expectToFailAsync } from "../../helpers/util";

describe("validate check", () => {
  describe("test-mini-upgrade", () => {
    it("prints all the information for the mini upgrade", async () => {
      const { stdout } = await execAsync("pnpm validate check reference/test-upgrade-mini");

      expect(stdout).toMatch(/Current protocol version.+\d+/);
      expect(stdout).toMatch(/Proposed protocol version.+1337/);
      expect(stdout).toContain("Verifier:");
      expect(stdout).toContain("L1 Main contract Diamond upgrades:");
      expect(stdout).toContain("No diamond changes");

      expect(stdout).toMatch(/Addres.+?0x[0-9a-fA-F]{40}.+?No changes/);
      expect(stdout).toMatch(
        /Recursion node level VkHash.+?0x[0-9a-fA-F]{64}.+?0x5a3ef282b21e12fe1f4438e5bb158fc5060b160559c5158c6389d62d9fe3d080/
      );
      expect(stdout).toMatch(/Recursion circuits set VksHash.+?0x[0-9a-fA-F]{64}.+?No changes/);
      expect(stdout).toMatch(
        /Recursion leaf level VkHash.+?0x[0-9a-fA-F]{64}.+?0x400a4b532c6f072c00d1806ef299300d4c104f4ac55bd8698ade78894fcadc0a/
      );

      expect(stdout).toContain("System contracts:");
      expect(stdout).toContain("No changes in system contracts");

      expect(stdout).toContain("Other contracts:");
      expect(stdout).toMatch(/Default Account.*0x[0-9a-fA-F]{64}.+No changes.+Yes/);
      expect(stdout).toMatch(/Bootloader.*0x[0-9a-fA-F]{64}.+No changes.+Yes/);
    });
  });

  describe("1699353977-boojum", () => {
    it("prints all the information for this upgrade", async () => {
      const { stdout } = await execAsync(
        "pnpm validate check reference/1699353977-boojum --ref=e77971dba8f589b625e72e69dd7e33ccbe697cc0"
      );

      const lines = stdout.split("\n");

      expect(stdout).toMatch(/Current protocol version.+\d+/);
      expect(stdout).toMatch(/Proposed protocol version.+18/);
      expect(stdout).toContain("L1 Main contract Diamond upgrades:");

      function validateFacet(facetName: string, facetAddress: string) {
        const adminFacetStartIndex = lines.findIndex((line) => line.includes(facetName));
        const facetLines = lines.slice(adminFacetStartIndex);
        const lastIndex = facetLines.findIndex((l) => l.includes("To compare code")) + 1;
        expect(adminFacetStartIndex).not.toBe(-1);
        expect(lastIndex).not.toBe(0);
        expect(facetLines[2]).toContain("Current address");
        expect(facetLines[3]).toMatch(new RegExp(`Upgrade address.*${facetAddress}`));
        expect(facetLines[4]).toContain("Proposed contract verified etherscan");
        expect(facetLines[4]).toContain("Yes");

        const newFunctionsLine = facetLines.findIndex((l) => l.includes("New functions"));
        expect(newFunctionsLine).toBeLessThan(lastIndex);

        const removedFunctionsLine = facetLines.findIndex((l) => l.includes("Removed functions"));
        expect(removedFunctionsLine).toBeLessThan(lastIndex);

        const compareLine = facetLines.findIndex((l) => l.includes("To compare code"));
        expect(compareLine).toBeLessThan(lastIndex);

        expect(facetLines[compareLine]).toContain(
          `pnpm validate facet-diff reference/1699353977-boojum ${facetName}`
        );
      }

      const facetData = [
        ["AdminFacet", "0x409560DE546e057ce5bD5dB487EdF2bB5E785baB", "None", "None"],
        ["ExecutorFacet", "0x9e3Fa34a10619fEDd7aE40A3fb86FA515fcfd269", "None", "None"],
        ["MailboxFacet", "0x63b5EC36B09384fFA7106A80Ec7cfdFCa521fD08", "None", "None"],
        ["GettersFacet", "0xF3ACF6a03ea4a914B78Ec788624B25ceC37c14A4", "getAllowList()", "None"],
      ] as const;

      for (const [name, addr] of facetData) {
        validateFacet(name, addr);
      }

      expect(stdout).toMatch(/Address.*0xB465882F67d236DcC0D090F78ebb0d838e9719D8/);

      expect(stdout).toMatch(
        /Recursion node level VkHash.*0x5a3ef282b21e12fe1f4438e5bb158fc5060b160559c5158c6389d62d9fe3d080/
      );

      expect(stdout).toMatch(/Recursion circuits set VksHash.*No changes/);

      expect(stdout).toMatch(
        /Recursion leaf level VkHash.*0x14628525c227822148e718ca1138acfc6d25e759e19452455d89f7f610c3dcb8/
      );

      expect(stdout).toMatch(
        /Show contract diff.*pnpm validate verifier-diff reference\/1699353977-boojum/
      );

      const systemContractData = [
        [
          "EmptyContract",
          "0x0000000000000000000000000000000000000000",
          "0x01000007271e9710c356751295d83a25ffec94be2b4ada01ec1fa04c7cd6f2c7",
        ],
        [
          "Ecrecover",
          "0x0000000000000000000000000000000000000001",
          "0x010000114daca2ff44f27d543b8ef67d885bfed09a74ba9cb25f5912dd3d739c",
        ],
        [
          "SHA256",
          "0x0000000000000000000000000000000000000002",
          "0x010000178d93b2d7d6448866009892223caf018a8e8dbcf090c2b9053a285f8d",
        ],
        [
          "EcAdd",
          "0x0000000000000000000000000000000000000006",
          "0x010000c5a85a372f441ac693210a18e683b530bed875fdcab2f7e101b057d433",
        ],
        [
          "EcMul",
          "0x0000000000000000000000000000000000000007",
          "0x0100013759b40792c2c3d033990e992e5508263c15252eb2d9bfbba571350675",
        ],
        [
          "EmptyContract",
          "0x0000000000000000000000000000000000008001",
          "0x01000007271e9710c356751295d83a25ffec94be2b4ada01ec1fa04c7cd6f2c7",
        ],
        [
          "AccountCodeStorage",
          "0x0000000000000000000000000000000000008002",
          "0x0100009bc0511159b5ec703d0c56f87615964017739def4ab1ee606b8ec6458c",
        ],
        [
          "NonceHolder",
          "0x0000000000000000000000000000000000008003",
          "0x0100012fa73fa922dd9fabb40d3275ce80396eff6ccf1b452c928c17d98bd470",
        ],
        [
          "KnownCodesStorage",
          "0x0000000000000000000000000000000000008004",
          "0x0100008b0ca6c6f277035366e99407fbb4b01e743e80b7d24dea5a3d647b423e",
        ],
        [
          "ImmutableSimulator",
          "0x0000000000000000000000000000000000008005",
          "0x01000047a3c40e3f4eb98f14967f141452ae602d8723a10975dc33960911d8c5",
        ],
        [
          "ContractDeployer",
          "0x0000000000000000000000000000000000008006",
          "0x010006091341955c8f76409de00549fb00b275166b5a0d0d7b82cbd629bb4212",
        ],
        [
          "L1Messenger",
          "0x0000000000000000000000000000000000008008",
          "0x01000301c943edb65f5a0b8cdd806218b8ecf25c022720fe3afe6951f202f3fa",
        ],
        [
          "MsgValueSimulator",
          "0x0000000000000000000000000000000000008009",
          "0x0100006fa1591d93fcc4a25e9340ad11d0e825904cd1842b8f7255701e1aacbb",
        ],
        [
          "L2EthToken",
          "0x000000000000000000000000000000000000800a",
          "0x01000139b506af2b02225838c5a33e30ace701b44b210a422eedab7dd31c28a3",
        ],
        [
          "SystemContext",
          "0x000000000000000000000000000000000000800b",
          "0x0100023ba65021e4689dd1755f82108214a1f25150d439fe58c55cdb1f376436",
        ],
        [
          "BootloaderUtilities",
          "0x000000000000000000000000000000000000800c",
          "0x010009759cab4fa9e6ca0784746e1df600ff523f0f90c1e94191755cab4b2ed0",
        ],
        [
          "EventWriter",
          "0x000000000000000000000000000000000000800d",
          "0x01000019642d87621fdd82cf65aa9146486c9256d5f8849af9a37c78ef519339",
        ],
        [
          "Compressor",
          "0x000000000000000000000000000000000000800e",
          "0x010001b72874590239af612f65d50a35975299f88de022493fe7f0a190e79496",
        ],
        [
          "ComplexUpgrader",
          "0x000000000000000000000000000000000000800f",
          "0x0100005bfc0443349233459892b51e9f67e27ac828d44d9c7cba8c8285fd66bc",
        ],
        [
          "Keccak256",
          "0x0000000000000000000000000000000000008010",
          "0x0100001fb52ca33668d01c230a1c3b13ede90fe2e37d77222410e9f183cb7a89",
        ],
      ] as const;

      for (const [name, addr, bytecodeHash] of systemContractData) {
        const systemContractLine = lines.findIndex(
          (line) => line.includes(name) && line.includes(addr)
        );
        expect(systemContractLine).not.toBe(-1);
        expect(lines[systemContractLine]).to.contain(addr);
        expect(lines[systemContractLine + 1]).to.contain(bytecodeHash);
      }

      const specialContractData = [
        ["Default Account", "0x01000651c5ae96f2aab07d720439e42491bb44c6384015e3a08e32620a4d582d"],
        [" Bootloader ", "0x01000983d4ac4f797cf5c077e022f72284969b13248c2a8e9846f574bdeb5b88"],
      ] as const;

      for (const [name, byteCodeHash] of specialContractData) {
        const line = lines.find((line) => line.includes(name));
        if (!line) {
          return expect.fail(`No line for ${name}`);
        }
        expect(line).toContain(name);
        expect(line).toContain(byteCodeHash);
        expect(line).toContain("Yes");
      }
    });

    it("should match snapshot", async ({ expect }) => {
      const { stdout } = await execAsync(
        "pnpm validate check reference/1699353977-boojum --ref=e77971dba8f589b625e72e69dd7e33ccbe697cc0"
      );
      expect(stdout).toMatchSnapshot();
    });
  });

  describe("1710255955-no-verified-contract", () => {
    it("returns that the contract is not verified on etherscan.", async () => {
      const { stdout } = await execAsync(
        "pnpm validate check reference/1710255955-no-verified-contract"
      );
      expect(stdout).to.match(/Proposed contract verified etherscan.*NO!/);
      expect(stdout).to.include("Warning!!:");
      expect(stdout).to.include(
        "⚠️ L1 Contract not verified in etherscan: 0x0011223344556677889900aabbccddeeff001122"
      );
    });
  });

  describe("when the directory is not a valid upgrade", () => {
    it("fails", async () => {
      const { stderr } = await expectToFailAsync(() =>
        execAsync("pnpm validate check reference/not_an_upgrade")
      );
      expect(stderr).to.contain(
        'Expected "reference/not_an_upgrade" to be an upgrade directory but it\'s not. Upgrade directories contain a "common.json" file inside'
      );
    });
  });

  describe("when directory does not exists", () => {
    it("fails", async () => {
      const { stderr } = await expectToFailAsync(() =>
        execAsync("pnpm validate check reference/not_a_directory")
      );
      expect(stderr).toContain(
        'Specified path "reference/not_a_directory" is not a directory or there are no permissions to access it.'
      );
    });
  });

  describe("when the upgrade is malformed", () => {
    it("fails with a propper error", async () => {
      const { stderr } = await expectToFailAsync(() =>
        execAsync("pnpm validate check reference/malformed-upgrade")
      );
      expect(stderr).toContain(
        'Problem processing specified upgrade: "reference/malformed-upgrade/common.json" does not follow expected schema.'
      );
    });
  });

  describe("when version is semver", () => {
    it("execs ok and shows correct version", async () => {
      const { stdout } = await execAsync("pnpm validate check reference/test-semver");
      expect(stdout).toMatch(/Current protocol version.+\d+\.\d+\.\d+/);
      expect(stdout).toMatch(/Proposed protocol version.*1.3.2009/);
    });
  });
});
