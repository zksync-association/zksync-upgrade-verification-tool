import { addressSchema } from "@repo/common/schemas";
import type { Request } from "express";
import {
  type State,
  deserialize as deserializeWagmiCookie,
  parseCookie as parseWagmiCookie,
} from "wagmi";

export const AUTH_COOKIE_NAME = "wagmi.store";

export function readAuthSession(req: Request) {
  const wagmiCookie = parseWagmiCookie(req.headers.cookie || "", AUTH_COOKIE_NAME);
  const cookie = wagmiCookie
    ? deserializeWagmiCookie<{ state: State }>(wagmiCookie).state
    : undefined;

  const address = cookie?.connections.get(cookie.current ?? "")?.accounts[0];
  const validatedAddress = addressSchema.safeParse(address);

  return { address: validatedAddress.success ? validatedAddress.data : undefined };
}
