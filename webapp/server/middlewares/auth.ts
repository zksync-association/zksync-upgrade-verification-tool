import { getUserAuthRole } from "@/.server/service/authorized-users";
import { readAuthSession } from "@server/utils/auth-session";
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
  const { address } = readAuthSession(req);

  // If the user is not logged in and tries to access a protected
  // route, redirect to the home page
  if (!address && isProtectedRoute(req)) {
    clearUserHeaders(req);
    return res.redirect($path("/"));
  }

  // If the user is not logged in and accesses any other route
  // clear the user headers and continue
  if (!address) {
    clearUserHeaders(req);
    return next();
  }

  // If user is logged in, just parse the user's role and set the headers
  const role = await getUserAuthRole(address);
  setUserHeaders(req, { address, role });

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
