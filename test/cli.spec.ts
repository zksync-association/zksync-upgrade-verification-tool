import { describe, expect, it } from "vitest";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import pkg from "../package.json" assert { type: "json" };

const execAsync = promisify(exec);

describe("CLI Output Test Suite", () => {
  it("should error on invalid option", async () => {
    await expect(execAsync("pnpm validate list --badOption defect")).rejects.toThrowError(
      "Unknown argument: badOption"
    );
  });

  it("should error on invalid command", async () => {
    await expect(execAsync("pnpm validate defect")).rejects.toThrowError(
      "Unknown argument: defect"
    );
  });

  it("should error on missing command", async () => {
    await expect(execAsync("pnpm validate")).rejects.toThrowError("You need to specify a command");
  });

  it("should display help", async () => {
    const { stdout } = await execAsync("pnpm validate --help");
    expect(stdout).toContain("entrypoint.js <command>");
    expect(stdout).toContain("Commands:");
    expect(stdout).toContain("Options:");
  });

  it("should display version", async () => {
    const { stdout } = await execAsync("pnpm validate --version");
    expect(stdout).toContain(pkg.version);
  });

  describe("Command: <list>", () => {
    it("should print current directory", async () => {
      const { stdout } = await execAsync("pnpm validate list");
      expect(stdout).toContain("./");
    });

    it("should support passing dir option", async () => {
      const { stdout } = await execAsync("pnpm validate list --directory node_modules");
      expect(stdout).toContain("🔎 Checking directories in node_modules for upgrades...");
    });

    it("should list upgrades", async () => {
      const { stdout } = await execAsync("pnpm validate list --directory reference");
      expect(stdout).toContain("🔎 Checking directories in reference for upgrades...");
      expect(stdout).toContain("1709067445-protodanksharding");
      expect(stdout).toContain("v1.4.2-enchancement");
    });
    it("should hide failing upgrades by default", async () => {
      const { stdout } = await execAsync("pnpm validate list --directory reference ");
      expect(stdout).not.toContain("failing-case");
      expect(stdout).not.toContain("N/A");
    });

    it("should list failing upgrades", async () => {
      const { stdout } = await execAsync("pnpm validate list --directory reference --hide false");
      expect(stdout).toContain("failing-case");
      expect(stdout).toContain("N/A");
    });

    it("should not display table when no upgrades found", async ({ expect }) => {
      const { stdout } = await execAsync("pnpm validate list");
      expect(stdout).toMatchSnapshot();
    });

    it("should match snapshot", async ({ expect }) => {
      const { stdout } = await execAsync("pnpm validate list --directory reference");
      expect(stdout).toMatchSnapshot();
    });

    it("should support absolute paths", async ({ expect }) => {
      const { stdout: realpath } = await execAsync("realpath reference");
      const { stdout } = await execAsync(`pnpm validate list --directory ${realpath}`);
      expect(stdout).toContain("1709067445-protodanksharding");
      expect(stdout).toMatchSnapshot();
    });
  });

  describe("Command: <check>", () => {
    
    it("should validate an upgrade", async () => {
      const { stdout } = await execAsync(
        "pnpm validate check test-upgrade-mini --directory reference"
      );
      expect(stdout).toContain("🔦 Checking upgrade with id: test-upgrade-mini");
      expect(stdout).toContain("✅ ");
    });

    it("should not contain failures", async () => {
      const { stdout } = await execAsync(
        "pnpm validate check test-upgrade-mini --directory reference"
      );
      expect(stdout).not.toContain("❌");
    });

    it("should match snapshot", async ({ expect }) => {
      const { stdout } = await execAsync(
        "pnpm validate check 1709067445-protodanksharding --directory reference"
      );
      expect(stdout).toMatchSnapshot();
    });

    it("should support absolute paths", async ({ expect }) => {
      const { stdout: realpath } = await execAsync("realpath reference");
      const { stdout } = await execAsync(
        `pnpm validate check test-upgrade-mini --directory ${realpath}`
      );
      expect(stdout).toContain("✅");
      expect(stdout).not.toContain("❌");
      expect(stdout).toMatchSnapshot();
    });
  });
});
