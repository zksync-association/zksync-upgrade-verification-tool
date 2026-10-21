// config/local-settings.server.ts for the single-file build: the same settings, kept in this
// browser's local storage instead of apps/web/.cache/local-settings.json.
import { STORAGE_PREFIX } from "@/common/storage-prefix";
import { z } from "zod";

const schema = z.object({
  L1_RPC_URL: z.string().url().optional(),
  L2_RPC_URL: z.string().url().nullable().optional(),
  SAFE_API_KEY: z.string().nullable().optional(),
  WALLET_CONNECT_PROJECT_ID: z.string().nullable().optional(),
});
export type LocalSettings = z.infer<typeof schema>;
type Name = keyof LocalSettings;
const NAMES = Object.keys(schema.shape) as Name[];
const KEY = `${STORAGE_PREFIX}zksync-governance-verifier.settings`;

function read(): LocalSettings {
  try {
    const parsed = schema.safeParse(JSON.parse(localStorage.getItem(KEY) ?? "{}"));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}
let settings: LocalSettings = read();

export function ignoredSettings(): { all: boolean; names: ReadonlySet<Name> } {
  return { all: false, names: new Set<Name>() };
}

export function localSetting(name: string): string | null | undefined {
  return NAMES.includes(name as Name) ? settings[name as Name] : undefined;
}

export function saveLocalSettings(next: LocalSettings) {
  const parsed = schema.parse({ ...settings, ...next });
  localStorage.setItem(KEY, JSON.stringify(parsed));
  settings = parsed;
}

/** An RPC URL has been saved: until then the app shows only its settings. */
export function hasRpcSetting() {
  return typeof settings.L1_RPC_URL === "string" && settings.L1_RPC_URL !== "";
}
