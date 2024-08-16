import { describe, expect, it } from "vitest";
import { execAsync, expectToFailAsync } from "../../helpers/util";
import pkg from "../../../package.json" assert { type: "json" };

describe("CLI Output Test Suite", () => {
  it("should error on invalid option", async () => {
    const { stdout } = await expectToFailAsync(() =>
      execAsync("pnpm validate check reference/test-upgrade-mini --badOption defect")
    );
    expect(stdout).to.contain("Unknown argument: badOption");
  });

  it("should error on invalid command", async () => {
    const { stdout } = await expectToFailAsync(() => execAsync("pnpm validate defect"));
    expect(stdout).to.contain("Unknown argument: defect");
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
      execAsync("pnpm validate check reference/test-upgrade-mini -n unknown-network")
    );
    expect(stdout).to.contain(
      'Argument: network, Given: "unknown-network", Choices: "mainnet", "sepolia"\n'
    );
  });
});
