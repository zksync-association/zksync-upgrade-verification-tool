import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const schema = z.object({
  L1_RPC_URL: z.string().url().optional(),
  L2_RPC_URL: z.string().url().nullable().optional(),
  SAFE_API_KEY: z.string().nullable().optional(),
});
export type LocalSettings = z.infer<typeof schema>;
type Name = keyof LocalSettings;
const NAMES = Object.keys(schema.shape) as Name[];

const path = resolve(".cache/local-settings.json");

/**
 * Saved settings this process ignores. Test suites run from apps/web, where a developer's saved
 * settings would otherwise replace what the suite names (the fork, a public RPC, a dummy URL):
 * - IGNORE_LOCAL_SETTINGS=true ignores all of them (hermetic suites);
 * - LOCAL_SETTINGS_IGNORE=L1_RPC_URL,L2_RPC_URL ignores only those, so e.g. a saved SAFE_API_KEY
 *   still applies.
 * With either, the file is never written: settings saved by this process stay in memory.
 */
export function ignoredSettings(environment: Record<string, string | undefined> = process.env): {
  all: boolean;
  names: ReadonlySet<Name>;
} {
  if (environment.IGNORE_LOCAL_SETTINGS === "true") return { all: true, names: new Set(NAMES) };
  const listed = (environment.LOCAL_SETTINGS_IGNORE ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  const unknown = listed.filter((name) => !NAMES.includes(name as Name));
  if (unknown.length > 0)
    throw new Error(
      `LOCAL_SETTINGS_IGNORE names unknown settings: ${unknown.join(", ")}. Known: ${NAMES.join(", ")}.`
    );
  return { all: false, names: new Set(listed as Name[]) };
}

const ignored = ignoredSettings();
const inMemoryOnly = ignored.all || ignored.names.size > 0;

let settings: LocalSettings = {};
try {
  if (!ignored.all) {
    const saved = schema.parse(JSON.parse(readFileSync(path, "utf8")));
    for (const name of ignored.names) delete saved[name];
    settings = saved;
  }
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT")
    throw new Error("Local settings could not be read. Check .cache/local-settings.json.");
}

export function localSetting(name: string): string | null | undefined {
  return settings[name as Name];
}

export function saveLocalSettings(next: LocalSettings) {
  const parsed = schema.parse({ ...settings, ...next });
  if (inMemoryOnly) {
    settings = parsed;
    return;
  }
  mkdirSync(resolve(".cache"), { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, JSON.stringify(parsed), { mode: 0o600 });
  renameSync(temporary, path);
  settings = parsed;
}
