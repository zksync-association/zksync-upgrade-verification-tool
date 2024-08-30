import type { Request } from "express";

export function getHost(req: Request) {
  return req.get("X-Forwarded-Host") ?? req.get("host") ?? "";
}
