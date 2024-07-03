export function getUserFromHeader(request: Request) {
  const address = request.headers.get("X-User-Address");
  return { address };
}

export function requireUserFromHeader(request: Request) {
  const { address } = getUserFromHeader(request);
  if (!address) {
    throw new Error("Unauthorized");
  }
  return { address };
}
