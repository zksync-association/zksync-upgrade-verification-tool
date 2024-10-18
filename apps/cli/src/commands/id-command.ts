import type { EnvBuilder } from "../lib/env-builder";
import { UpgradeFile } from "../lib/upgrade-file";

export function idCommand(_env: EnvBuilder, upgradePath: string) {
  const upgradeFile = UpgradeFile.fromFile(upgradePath);

  _env.term().line(upgradeFile.id());
}
