import type { NextFunction, Request, Response } from "express";
import pinoHttp from "pino-http";

const pinoLogger = pinoHttp<Request, Response>({
  level: "info",
  autoLogging: { ignore: (req) => shouldSkipLog(req) },
  customLogLevel: (_req, res, error) => {
    if (error || res.statusCode >= 500) {
      return "error";
    }
    if (res.statusCode >= 400) {
      return "warn";
    }
    return "info";
  },
  serializers: {
    req: () => undefined,
    res: () => undefined,
  },
  customSuccessMessage: (req) => `${req.method} ${loggedUrl(req.originalUrl)} completed`,
  customSuccessObject: (req, res, val) => ({
    method: req.method,
    url: loggedUrl(req.originalUrl),
    statusCode: res.statusCode,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    responseTime: val.responseTime as number,
  }),
});

export function logger(req: Request, res: Response, next: NextFunction) {
  pinoLogger(req, res, next);
}

function isHealthcheck(req: Request) {
  const extReq =
    req.method === "GET" &&
    req.res?.statusCode === 200 &&
    req.url?.startsWith("/resources/healthcheck");
  const innerReq =
    req.method === "HEAD" && req.res?.statusCode === 200 && req.headers["x-healthcheck"] === "true";
  return extReq || innerReq;
}

/**
 * The request's path and query as logged: the value of every `sig` parameter (a signature the
 * viewer supplied, `?sig=<memberSafe>:<signature>`, which AGENTS.md says is stored nowhere) is
 * left out, so a log written to a file never holds one.
 */
export function loggedUrl(url: string | undefined): string {
  const value = url ?? "";
  const at = value.indexOf("?");
  if (at < 0) return value;
  const query = value
    .slice(at + 1)
    .split("&")
    .map((part) => {
      const eq = part.indexOf("=");
      const name = eq < 0 ? part : part.slice(0, eq);
      return safeDecode(name).trim().toLowerCase() === "sig" ? `${name}=[redacted]` : part;
    })
    .join("&");
  return `${value.slice(0, at)}?${query}`;
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value;
  }
}

/** Health checks, and the beats open tabs send every 10 s (sync/presence.ts): never logged. */
export function shouldSkipLog(req: Request) {
  return isHealthcheck(req) || isPresenceBeat(req);
}

function isPresenceBeat(req: Request) {
  const path = (req.path ?? req.url ?? "").split("?")[0] ?? "";
  return path.toLowerCase().replace(/\/+$/, "") === "/resources/presence";
}
