import type { NextFunction, Request, Response } from "express";
import pinoHttp from "pino-http";

const pinoLogger = pinoHttp<Request, Response>({
  level: "info",
  autoLogging: {
    ignore: (req) => {
      return isHealthcheck(req);
    },
  },
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
  customSuccessMessage: (req) => `${req.method} ${req.originalUrl} completed`,
  customSuccessObject: (req, res, val) => ({
    method: req.method,
    url: req.originalUrl,
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
