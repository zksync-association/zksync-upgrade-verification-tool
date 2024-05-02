import {describe, expect, it} from "vitest";
import { execAsync } from "./util";
import pkg from "../package.json" assert { type: "json" };

describe("CLI Output Test Suite", () => {
  it("should error on invalid option", async () => {
    await expect(
      execAsync(
        `pnpm validate check reference/test-upgrade-mini --badOption defect`
      )
    ).rejects.toThrowError("Unknown argument: badOption");
  });

  it("should error on invalid command", async () => {
    await expect(
      execAsync("pnpm validate defect")
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

  it("errors if non supported network", async () => {
    await expect(() => execAsync("pnpm validate check reference/test-upgrade-mini -n unknown-network")).rejects
      .toThrowError("Argument: network, Given: \"unknown-network\", Choices: \"mainnet\", \"sepolia\"\n")
  })
})