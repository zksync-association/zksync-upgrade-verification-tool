// Emergency payloads stay in the browser (sessionStorage), keyed by the id they hash to. They are
// confidential until executed, so they are never sent to this app's server unless the user asks
// for a simulation.

const key = (id: string) => `emergency-payload:${id.toLowerCase()}`;

export function savePayload(id: string, payload: unknown) {
  try {
    sessionStorage.setItem(key(id), JSON.stringify(payload));
  } catch {}
}

export function loadPayload(id: string): unknown | null {
  try {
    const raw = sessionStorage.getItem(key(id));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function forgetPayload(id: string) {
  try {
    sessionStorage.removeItem(key(id));
  } catch {}
}
