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
          env.NODE_ENV === "development" ? env.L1_RPC_URL_FOR_UPGRADES : null,
          "*.sentry.io",
          "'self'",
          "https://explorer-api.walletconnect.com",
          "https://enhanced-provider.rainbow.me",
        ].filter(Boolean) as string[],
        "font-src": ["'self'", "https://rsms.me"],
        "frame-src": ["'self'", "https://verify.walletconnect.com"],
        "img-src": [
          "'self'",
          "data:",
          "https://explorer-api.walletconnect.com",
          "https://verify.walletconnect.com",
        ],
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
