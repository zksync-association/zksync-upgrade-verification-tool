import type { NextFunction, Request, Response } from "express";
import { getHost } from "../utils/get-host";

export function requireHttps(req: Request, res: Response, next: NextFunction) {
  const proto = req.get("X-Forwarded-Proto");
  const host = getHost(req);
  if (proto === "http") {
    res.set("X-Forwarded-Proto", "https");
    res.redirect(`https://${host}${req.originalUrl}`);
    return;
  }
  next();
}
