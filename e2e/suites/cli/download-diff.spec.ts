import { describe, expect, it } from "vitest";
import "dotenv/config";
import { createTempDir, execAsync, expectToFailAsync } from "../../helpers/util";
import * as fs from "node:fs/promises";
import * as path from "node:path";

describe("validate download-diff", () => {
  it("fails when target path does not exists", async () => {
    const temp = createTempDir();
    await fs.rmdir(temp);
    const { stderr } = await expectToFailAsync(() =>
      execAsync(`pnpm validate download-diff reference/test-upgrade-mini ${temp}`)
    );
    expect(stderr).toContain(
      `Specified path "${temp}" is not a directory or there are no permissions to access it.`
    );
  });

  it("downloads all the files inside the specified directory ", async () => {
    const temp = createTempDir();
    const { stdout } = await execAsync(
      `pnpm validate download-diff reference/1699353977-boojum ${temp} --ref=e77971dba8f589b625e72e69dd7e33ccbe697cc0`
    );
    expect(stdout).toContain(`✅ Source code successfully downloaded in: ${temp}`);
    const subFolders = await fs.readdir(temp, { recursive: false });
    expect(subFolders).toEqual(expect.arrayContaining(["old", "new"]));
    const oldFolder = path.join(temp, "old");
    const expectedOldSubDirs = ["facets", "verifier", "system-contracts"];
    expect(await fs.readdir(oldFolder, { recursive: false })).toEqual(
      expect.arrayContaining(expectedOldSubDirs)
    );
    const newFolder = path.join(temp, "new");
    const expectedNewSubDirs = [
      "facets",
      "verifier",
      "system-contracts",
      "bootloader",
      "defaultAA",
    ];
    expect(await fs.readdir(newFolder, { recursive: false })).toEqual(
      expect.arrayContaining(expectedNewSubDirs)
    );
    const facets = ["AdminFacet", "ExecutorFacet", "GettersFacet", "MailboxFacet"];
    expect(await fs.readdir(path.join(newFolder, "facets"), { recursive: false })).toEqual(
      expect.arrayContaining(facets)
    );
    expect(await fs.readdir(path.join(oldFolder, "facets"), { recursive: false })).toEqual(
      expect.arrayContaining(facets)
    );
    const sysContracts = [
      "EmptyContract",
      "Ecrecover",
      "SHA256",
      "EcAdd",
      "EcMul",
      "EmptyContract",
      "AccountCodeStorage",
      "NonceHolder",
      "KnownCodesStorage",
      "ImmutableSimulator",
      "ContractDeployer",
      "L1Messenger",
      "MsgValueSimulator",
      "L2EthToken",
      "SystemContext",
      "BootloaderUtilities",
      "EventWriter",
      "Compressor",
      "ComplexUpgrader",
      "Keccak256",
    ];
    expect(
      await fs.readdir(path.join(newFolder, "system-contracts"), { recursive: false })
    ).toEqual(expect.arrayContaining(sysContracts));
    expect(
      await fs.readdir(path.join(oldFolder, "system-contracts"), { recursive: false })
    ).toEqual(expect.arrayContaining(sysContracts));
  });
});
