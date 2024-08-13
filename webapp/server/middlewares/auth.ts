import { getUserAuthRole } from "@/.server/service/authorized-users";
import { readAuthSession } from "@server/utils/auth-session";
import type { NextFunction, Request, Response } from "express";
import { $path, type Routes } from "remix-routes";
import { hexSchema } from "@/common/basic-schemas";

export const USER_ADDRESS_HEADER = "x-user-address";
export const USER_ROLE_HEADER = "x-user-role";

const protectedRoutes = [] satisfies (keyof Routes)[];
const unprotectedRoutes = ["/", "/app/denied", "/app/down"] satisfies (keyof Routes)[];

function isProtectedRoute(req: Request) {
  return (
    protectedRoutes.some((route) => req.path.startsWith(route)) &&
    !unprotectedRoutes.some((route) => req.path === route)
  );
}

export async function auth(req: Request, res: Response, next: NextFunction) {
  const session = readAuthSession(req);

  const parsed = hexSchema.safeParse(session.address);
  if (parsed.error) {
    clearUserHeaders(req);
    return next();
  }

  const role = await getUserAuthRole(hexSchema.parse(parsed.data));
  setUserHeaders(req, { address: parsed.data, role });

  if (isProtectedRoute(req) && role === "visitor") {
    return res.redirect($path("/app/denied"));
  }

  next();
}

function setUserHeaders(req: Request, { address, role }: { address: string; role: string | null }) {
  req.headers[USER_ADDRESS_HEADER] = address;
  req.headers[USER_ROLE_HEADER] = role || "";
}

function clearUserHeaders(req: Request) {
  delete req.headers[USER_ADDRESS_HEADER];
  delete req.headers[USER_ROLE_HEADER];
}
