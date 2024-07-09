import { isUserAuthorized } from "@/.server/service/authorized-users";
import { readAuthSession } from "@server/utils/auth-session";
import type { NextFunction, Request, Response } from "express";
import { $path, type Routes } from "remix-routes";
import { zodHex } from "validate-cli/src";

export const USER_ADDRESS_HEADER = "x-user-address";

const protectedRoutes = ["/app"] satisfies (keyof Routes)[];
const unprotectedRoutes = ["/", "/app/denied"] satisfies (keyof Routes)[];

function isProtectedRoute(req: Request) {
  return (
    protectedRoutes.some((route) => req.path.startsWith(route)) &&
    !unprotectedRoutes.some((route) => req.path === route)
  );
}

export async function auth(req: Request, res: Response, next: NextFunction) {
  const session = readAuthSession(req);

  if (isProtectedRoute(req)) {
    // If user is not logged in, redirect to home page
    if (!session?.siwe?.success) {
      clearUserHeaders(req);
      return res.redirect($path("/"));
    }

    const authorized = await isUserAuthorized(zodHex.parse(session.siwe.data.address));

    // Session headers are set for all requests, authorized or not,
    // to be used by Remix loaders
    setUserHeaders(req, { address: session.siwe.data.address });

    // If user is logged in but not authorized, redirect to denied page
    if (!authorized) {
      return res.redirect($path("/app/denied"));
    }

    return next();
  }

  // If route is not protected, Remix might still need user information
  if (session?.siwe?.success) {
    setUserHeaders(req, { address: session.siwe.data.address });
  } else {
    clearUserHeaders(req);
  }

  next();
}

function setUserHeaders(req: Request, { address }: { address: string }) {
  req.headers[USER_ADDRESS_HEADER] = address;
}

function clearUserHeaders(req: Request) {
  delete req.headers[USER_ADDRESS_HEADER];
}
