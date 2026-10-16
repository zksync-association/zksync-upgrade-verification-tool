// config/log.server.ts (pino) for the single-file build: the same calls, warnings and errors to
// the browser console.
type Fields = Record<string, unknown>;
type Logger = Record<string, unknown> & { child(fields: Fields): Logger };
function make(bindings: Fields): Logger {
  const at = (level: "warn" | "error" | null) => (a?: unknown, b?: unknown) => {
    if (!level) return;
    const raw = typeof a === "object" && a !== null ? (a as Fields) : {};
    // Errors print as their message (an Error has no enumerable fields).
    const fields = Object.fromEntries(
      Object.entries(raw).map(([k, v]) => [k, v instanceof Error ? `${v.name}: ${v.message}` : v])
    );
    console[level]("[verifier]", typeof a === "string" ? a : b, { ...bindings, ...fields });
  };
  return {
    trace: at(null),
    debug: at(null),
    info: at(null),
    warn: at("warn"),
    error: at("error"),
    fatal: at("error"),
    level: "warn",
    child: (more: Fields) => make({ ...bindings, ...more }),
  };
}
export const defaultLogger = make({});
export default defaultLogger;
