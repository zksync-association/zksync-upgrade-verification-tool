import baseHelmet from "helmet";

import { env } from "@config/env.server";

export function helmet() {
  return baseHelmet({
    xPoweredBy: false,
    referrerPolicy: { policy: "same-origin" },
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      // NOTE: Remove reportOnly when you're ready to enforce this CSP
      reportOnly: true,
      directives: {
        "connect-src": [
          env.NODE_ENV === "development" ? "ws:" : null,
          "*.sentry.io",
          "'self'",
        ].filter(Boolean) as string[],
        "font-src": ["'self'"],
        "frame-src": ["'self'"],
        "img-src": ["'self'", "data:"],
        "script-src": [
          "'strict-dynamic'",
          "'self'",
          // @ts-expect-error res.locals is set by previous middleware
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          (_, res) => `'nonce-${res.locals.cspNonce}'`,
        ],
        "script-src-attr": [
          // @ts-expect-error res.locals is set by previous middleware
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          (_, res) => `'nonce-${res.locals.cspNonce}'`,
        ],
        "upgrade-insecure-requests": null,
      },
    },
  });
}
