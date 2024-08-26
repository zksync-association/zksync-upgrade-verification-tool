import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export function cspNonce(_req: Request, res: Response, next: NextFunction) {
  res.locals.cspNonce = crypto.randomBytes(16).toString("hex");
  next();
}
