import type { NextFunction, Request, Response } from "express";

export function removeTrailingSlash(req: Request, res: Response, next: NextFunction) {
  if (req.path.endsWith("/") && req.path.length > 1) {
    const query = req.url.slice(req.path.length);
    const safepath = req.path.slice(0, -1).replace(/\/+/g, "/");
    res.redirect(302, safepath + query);
  } else {
    next();
  }
}
