import type { NextFunction, Request, Response } from "express";
import expressRateLimit from "express-rate-limit";

import { env } from "@config/env.server";

// When running tests or running in development, we want to effectively disable
// rate limiting because playwright tests are very fast and we don't want to
// have to wait for the rate limit to reset between tests.
const maxMultiple =
  env.NODE_ENV !== "production" // || process.env.PLAYWRIGHT_TEST_BASE_URL
    ? 10_000
    : 100;

const rateLimitDefault = {
  windowMs: 60 * 1000,
  max: 1000 * maxMultiple,
  standardHeaders: true,
  legacyHeaders: false,
  // Fly.io prevents spoofing of X-Forwarded-For
  // so no need to validate the trustProxy config
  validate: { trustProxy: false },
};

const strongestRateLimit = expressRateLimit({
  ...rateLimitDefault,
  windowMs: 60 * 1000,
  max: 10 * maxMultiple,
});

const strongRateLimit = expressRateLimit({
  ...rateLimitDefault,
  windowMs: 60 * 1000,
  limit: 100 * maxMultiple,
});

const generalRateLimit = expressRateLimit(rateLimitDefault);

export function rateLimit(req: Request, res: Response, next: NextFunction) {
  const strongPaths: string[] = [
    // TODO
  ];

  if (req.method !== "GET" && req.method !== "HEAD") {
    if (strongPaths.some((p) => req.path.includes(p))) {
      return strongestRateLimit(req, res, next);
    }
    return strongRateLimit(req, res, next);
  }

  return generalRateLimit(req, res, next);
}
