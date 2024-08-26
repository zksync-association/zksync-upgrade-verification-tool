import "dotenv/config";
import { cli } from "./lib/index.js";

try {
  await cli().catch((_e) => process.exit(1));
} catch (_e) {
  process.exit(1);
}
