const DOTS = "••••••••";

// Hidden, a saved value still shows that it is there: an RPC URL keeps its provider's host, and the
// hidden part its last four characters (none when it is short).
export function maskSaved(value: string, kind: "url" | "key") {
  const tail = (hidden: string) => (hidden.length > 12 ? hidden.slice(-4) : "");
  if (kind === "url") {
    try {
      const url = new URL(value);
      const credentials = url.username || url.password ? `${url.username}:${url.password}@` : "";
      const hidden = credentials + url.pathname.slice(1) + url.search + url.hash;
      const base = `${url.protocol}//${url.host}/`;
      return hidden ? `${base}${DOTS}${tail(hidden)}` : base;
    } catch {
      // Not a URL: masked like a key.
    }
  }
  return `${DOTS}${tail(value)}`;
}
