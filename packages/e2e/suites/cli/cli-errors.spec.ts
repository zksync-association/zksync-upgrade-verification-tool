import { describe, expect, it } from "vitest";
import { execAsync, expectToFailAsync } from "./helpers/util.js";
import pkg from "../../../../apps/cli/package.json";

describe("CLI Output Test Suite", () => {
  it("errors on invalid option", async () => {
    const { stdout } = await expectToFailAsync(() =>
      execAsync("pnpm validate check -f some/file --badOption defect")
    );
    expect(stdout).to.contain("Unknown argument: badOption");
  });

  it("errors on missing update file option", async () => {
    const { stdout } = await expectToFailAsync(() =>
      execAsync("pnpm validate check")
    );
    expect(stdout).to.contain("Missing required argument: file");
  });

  it("should error on invalid command", async () => {
    const { stdout } = await expectToFailAsync(() => execAsync("pnpm validate -f some/file unknownCommand"));
    expect(stdout).to.contain("Unknown argument: unknownCommand");
  });

  it("should error on missing command", async () => {
    const { stdout } = await expectToFailAsync(() => execAsync("pnpm validate"));
    expect(stdout).to.include("Please specify a command");
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
    const { stdout } = await expectToFailAsync(() =>
      execAsync("pnpm validate -f some/file check -n unknown-network")
    );
    expect(stdout).to.contain(
      'Argument: network, Given: "unknown-network", Choices: "mainnet", "sepolia"\n'
    );
  });
});
