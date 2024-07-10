import type { Request } from "express";
import {
  type State,
  deserialize as deserializeWagmiCookie,
  parseCookie as parseWagmiCookie,
} from "wagmi";

export const AUTH_COOKIE_NAME = "wagmi.store";

export function readAuthSession(req: Request) {
  const wagmiCookie = parseWagmiCookie(req.headers.cookie || "", "wagmi.store");
  const cookie = wagmiCookie
    ? deserializeWagmiCookie<{ state: State }>(wagmiCookie).state
    : undefined;
  return { address: cookie?.connections.get(cookie.current ?? "")?.accounts[0] };
}
