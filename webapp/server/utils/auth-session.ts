import type { Request as ExpressRequest } from "express";
import type { SiweResponse } from "siwe";

declare global {
  namespace Express {
    interface Request {
      session: AuthSession | null;
    }
  }
}

interface AuthSession {
  nonce?: string;
  siwe?: SiweResponse;
}

export const AUTH_COOKIE_NAME = "auth";

export function saveAuthSession(req: ExpressRequest, data: Partial<AuthSession>) {
  if (req.session !== null && data.siwe) {
    req.session.siwe = data.siwe;
  }
  if (req.session !== null && data.nonce) {
    req.session.nonce = data.nonce;
  }
}

export function readAuthSession(req: ExpressRequest) {
  return req.session;
}

export function deleteAuthSession(req: ExpressRequest) {
  req.session = null;
}
