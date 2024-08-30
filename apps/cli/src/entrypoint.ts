import "dotenv/config";
import { cli } from "./lib/cli.js";

try {
  await cli().catch((_e) => process.exit(1));
} catch {
  process.exit(1);
}
