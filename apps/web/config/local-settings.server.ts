import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const schema = z.object({
  L1_RPC_URL: z.string().url().optional(),
  L2_RPC_URL: z.string().url().nullable().optional(),
  SAFE_API_KEY: z.string().nullable().optional(),
});
export type LocalSettings = z.infer<typeof schema>;
const path = resolve(".cache/local-settings.json");
// Test suites set IGNORE_LOCAL_SETTINGS=true: they run from apps/web, where a developer's saved
// settings would otherwise replace the RPC the suite names (the fork, a public RPC, a dummy URL).
// Settings saved under it stay in memory.
const ignored = process.env.IGNORE_LOCAL_SETTINGS === "true";
let settings: LocalSettings = {};
try {
  if (!ignored) settings = schema.parse(JSON.parse(readFileSync(path, "utf8")));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT")
    throw new Error("Local settings could not be read. Check .cache/local-settings.json.");
}

export function localSetting(name: string): string | null | undefined {
  return settings[name as keyof LocalSettings];
}

export function saveLocalSettings(next: LocalSettings) {
  const parsed = schema.parse({ ...settings, ...next });
  if (ignored) {
    settings = parsed;
    return;
  }
  mkdirSync(resolve(".cache"), { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, JSON.stringify(parsed), { mode: 0o600 });
  renameSync(temporary, path);
  settings = parsed;
}
