import "dotenv/config";
import { cli } from "./lib";

try {
  await cli().catch((_e) => process.exit(1));
} catch (_e) {
  process.exit(1);
}
