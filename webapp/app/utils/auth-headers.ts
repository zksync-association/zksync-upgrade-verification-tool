import { USER_ADDRESS_HEADER } from "@server/middlewares/auth";

export function getUserFromHeader(request: Request) {
  const address = request.headers.get(USER_ADDRESS_HEADER);
  return { address };
}

export function requireUserFromHeader(request: Request) {
  const { address } = getUserFromHeader(request);
  if (!address) {
    throw new Error("Unauthorized");
  }
  return { address };
}
