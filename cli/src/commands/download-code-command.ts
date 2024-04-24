import { compareCurrentStateWith, type Network } from "../lib";
import * as console from "node:console";
import { withSpinner } from "../lib/with-spinner.js";

export async function downloadCode(
  etherscanKey: string,
  network: Network,
  upgradeDirectory: string,
  targetDir: string,
  l1Filter: string[]
): Promise<void> {
  const { diff, client } = await withSpinner(() =>
    compareCurrentStateWith(etherscanKey, network, upgradeDirectory)
  );
  await diff.writeCodeDiff(targetDir, l1Filter, client);
  console.log(`Ok! Contracts written in: ${targetDir}`);
}
