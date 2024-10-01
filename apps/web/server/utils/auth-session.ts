import { addressSchema } from "@repo/common/schemas";
import {
  type State,
  deserialize as deserializeWagmiCookie,
  parseCookie as parseWagmiCookie,
} from "wagmi";

export const AUTH_COOKIE_NAME = "wagmi.store";

export function readAuthSession(cookies: string) {
  const wagmiCookie = parseWagmiCookie(cookies, AUTH_COOKIE_NAME);
  const cookie = wagmiCookie
    ? deserializeWagmiCookie<{ state: State }>(wagmiCookie).state
    : undefined;

  const address = cookie?.connections.get(cookie.current ?? "")?.accounts[0];
  const validatedAddress = addressSchema.safeParse(address);
  if (!validatedAddress.success) {
    return { address: undefined };
  }

  return { address: validatedAddress.data };
}
