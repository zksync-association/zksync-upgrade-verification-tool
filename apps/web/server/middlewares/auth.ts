import { readAuthSession } from "@server/utils/auth-session";
import { readUserRoleCookie } from "@server/utils/user-role-cookie";
import type { NextFunction, Request, Response } from "express";
import { $path, type Routes } from "remix-routes";

export const USER_ADDRESS_HEADER = "x-user-address";
export const USER_ROLE_HEADER = "x-user-role";

const protectedRoutes = ["/app"] satisfies (keyof Routes)[];
const unprotectedRoutes = ["/", "/app/denied", "/app/down"] satisfies (keyof Routes)[];

function isProtectedRoute(req: Request) {
  return (
    protectedRoutes.some((route) => req.path.startsWith(route)) &&
    !unprotectedRoutes.some((route) => req.path === route)
  );
}

export async function auth(req: Request, res: Response, next: NextFunction) {
  // Read the user's address and role
  const { address } = readAuthSession(req.headers.cookie ?? "");
  const role = readUserRoleCookie(req.headers.cookie ?? "");

  // If the user is not logged in and tries to access a protected
  // route, redirect to the home page
  if ((!address || !role) && isProtectedRoute(req)) {
    return res.redirect($path("/"));
  }

  // Otherwise, continue
  return next();
}
