import { describe, expect, it } from "vitest";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import pkg from "../package.json" assert { type: "json" };

const execAsync = promisify(exec);

const etherscanKey = process.env.ETHERSCAN_API_KEY;

describe("CLI Output Test Suite", () => {
  it("should error on invalid option", async () => {
    await expect(
      execAsync(
        `pnpm validate --ethscankey='${etherscanKey}' check reference/test-upgrade-mini --badOption defect`
      )
    ).rejects.toThrowError("Unknown argument: badOption");
  });
  //
  it("should error on invalid command", async () => {
    await expect(
      execAsync(`pnpm validate --ethscankey='${etherscanKey}' defect`)
    ).rejects.toThrowError("Unknown argument: defect");
  });

  it("should error on missing command", async () => {
    await expect(execAsync("pnpm validate")).rejects.toThrowError("Please specify a command");
  });

  it("should display help", async () => {
    const { stdout } = await execAsync("pnpm validate --help");
    expect(stdout).toContain("validate <command>");
    expect(stdout).toContain("Commands:");
    expect(stdout).toContain("Options:");
  });

  it("should display version", async () => {
    const { stdout } = await execAsync("pnpm validate --version");
    expect(stdout).toContain(pkg.version);
  });

  describe("Command: <check>", () => {
    it("should validate an upgrade", async () => {
      const { stdout } = await execAsync(
        `pnpm validate --ethscankey='${etherscanKey}' check reference/test-upgrade-mini`
      );

      expect(stdout).toMatch(/Current protocol version.+\d+/);
      expect(stdout).toMatch(/Proposed protocol version.+1337/);
      expect(stdout).toContain("Verifier:");
      expect(stdout).toContain("L1 Main contract Diamond upgrades:");
      expect(stdout).toContain("No diamond changes");

      expect(stdout).toMatch(/Addres.+?0x[0-9a-fA-F]{40}.+?0x0{40}/);
      expect(stdout).toMatch(
        /Recursion node level VkHash.+?0x[0-9a-fA-F]{64}.+?0x400a4b532c6f072c00d1806ef299300d4c104f4ac55bd8698ade78894fcadc0a/
      );
      expect(stdout).toMatch(
        /Recursion circuits set VksHash.+?0x[0-9a-fA-F]{64}.+?0x0000000000000000000000000000000000000000000000000000000000000000/
      );
      expect(stdout).toMatch(
        /Recursion leaf level VkHash.+?0x[0-9a-fA-F]{64}.+?0x5a3ef282b21e12fe1f4438e5bb158fc5060b160559c5158c6389d62d9fe3d080/
      );
    });

    it("should match snapshot", async ({ expect }) => {
      const { stdout } = await execAsync(
        `pnpm validate check reference/1699353977-boojum --ref=e77971dba8f589b625e72e69dd7e33ccbe697cc0 --ethscankey='${etherscanKey}'`
      );
      expect(stdout).toMatchSnapshot();
    });
  });
});
