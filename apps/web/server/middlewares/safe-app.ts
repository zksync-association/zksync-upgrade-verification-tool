import type { NextFunction, Request, Response } from "express";

// Safe{Wallet} opens a Safe App in an iframe after reading its manifest. Only the configured
// Safe{Wallet} origins (and the app itself) may embed the pages; the manifest and its icon are
// readable from any origin because Safe{Wallet} fetches them when a user adds the app.
const PUBLIC_PATHS = new Set(["/manifest.json", "/safe-app-icon.svg"]);

export function safeAppHeaders(origins: string[]) {
  const policy = `frame-ancestors ${["'self'", ...origins].join(" ")}`;
  return (req: Request, res: Response, next: NextFunction) => {
    res.set("Content-Security-Policy", policy);
    if (PUBLIC_PATHS.has(req.path)) res.set("Access-Control-Allow-Origin", "*");
    next();
  };
}

export const safeAppManifest = {
  name: "ZKsync Governance",
  description:
    "Check and sign ZKsync governance actions. Every signature is verified on-chain before it counts.",
  iconPath: "safe-app-icon.svg",
  icons: [{ src: "safe-app-icon.svg", sizes: "any", type: "image/svg+xml" }],
};
