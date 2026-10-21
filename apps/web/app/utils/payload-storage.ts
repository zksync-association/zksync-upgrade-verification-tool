// Emergency payloads stay in this browser, keyed by the id they hash to, with when they were
// prepared or loaded here: kept until removed (localStorage), so a prepared upgrade is still listed
// after its tab is closed (Prepared in this browser, on the emergency list). They are confidential
// until executed, so they are never sent to this app's server unless the user asks for a
// simulation. Copies kept for a tab only (sessionStorage, before) move here when read.
import { STORAGE_PREFIX } from "@/common/storage-prefix";

const PREFIX = `${STORAGE_PREFIX}emergency-payload:`;
const key = (id: string) => `${PREFIX}${id.toLowerCase()}`;

export type SavedPayload = { id: string; payload: unknown; savedAt: number };

type Stored = { payload: unknown; savedAt: number };

function parse(raw: string | null): Stored | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (value && typeof value === "object" && "payload" in value && "savedAt" in value)
      return value as Stored;
    // A copy saved as the bare payload (sessionStorage, before).
    return { payload: value, savedAt: Date.now() };
  } catch {
    return null;
  }
}

/** Tab-only copies, moved to the copies kept until removed. */
function migrate() {
  try {
    for (const k of Object.keys(sessionStorage)) {
      if (!k.startsWith(PREFIX)) continue;
      const stored = parse(sessionStorage.getItem(k));
      if (stored && !localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify(stored));
      sessionStorage.removeItem(k);
    }
  } catch {}
}

export function savePayload(id: string, payload: unknown) {
  try {
    // Prepared earlier: keeps its time.
    const savedAt = parse(localStorage.getItem(key(id)))?.savedAt ?? Date.now();
    localStorage.setItem(key(id), JSON.stringify({ payload, savedAt } satisfies Stored));
  } catch {}
}

export function loadPayload(id: string): unknown | null {
  migrate();
  try {
    return parse(localStorage.getItem(key(id)))?.payload ?? null;
  } catch {
    return null;
  }
}

export function forgetPayload(id: string) {
  try {
    localStorage.removeItem(key(id));
    sessionStorage.removeItem(key(id));
  } catch {}
}

/** Every payload kept here, the newest first. */
export function listPayloads(): SavedPayload[] {
  migrate();
  try {
    return Object.keys(localStorage)
      .filter((k) => k.startsWith(PREFIX))
      .flatMap((k) => {
        const stored = parse(localStorage.getItem(k));
        return stored ? [{ id: k.slice(PREFIX.length), ...stored }] : [];
      })
      .sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

/** True for a change to the payloads kept here made in another tab. */
export const isPayloadChange = (event: StorageEvent) =>
  event.key === null || event.key.startsWith(PREFIX);
