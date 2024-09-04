import { env } from "@config/env.server";
import type { NextFunction, Request, Response } from "express";
import { $path, type Routes } from "remix-routes";

const privateRoutes = [
  "/app/emergency",
  "/app/freeze",
  "/app/l2-cancellations",
] satisfies (keyof Routes)[];

function isPrivateRoute(req: Request) {
  return privateRoutes.some((route) => req.path.startsWith(route));
}

export async function protectPrivateRoutes(req: Request, res: Response, next: NextFunction) {
  if (!env.ALLOW_PRIVATE_ACTIONS && isPrivateRoute(req)) {
    return res.redirect($path("/"));
  }

  next();
}
