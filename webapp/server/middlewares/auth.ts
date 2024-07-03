import { readAuthSession } from "@server/utils/auth-session";
import type { NextFunction, Request, Response } from "express";

export async function auth(req: Request, res: Response, next: NextFunction) {
  const session = readAuthSession(req);
  if (session?.siwe?.success) {
    req.headers["X-User-Address"] = session.siwe.data.address;
  } else {
    req.headers["X-User-Address"] = undefined;
  }
  next();
}
