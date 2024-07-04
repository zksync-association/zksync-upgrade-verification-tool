import { readAuthSession } from "@server/utils/auth-session";
import type { NextFunction, Request, Response } from "express";

export const USER_ADDRESS_HEADER = "x-user-address";

export async function auth(req: Request, res: Response, next: NextFunction) {
  const session = readAuthSession(req);
  if (session?.siwe?.success) {
    req.headers[USER_ADDRESS_HEADER] = session.siwe.data.address;
  } else {
    delete req.headers[USER_ADDRESS_HEADER];
  }
  next();
}
