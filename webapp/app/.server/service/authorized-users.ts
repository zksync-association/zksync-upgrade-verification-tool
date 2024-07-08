export async function isUserAuthorized(address: string) {
  return new Promise((resolve, _) => setTimeout(() => resolve(true), 200)) as Promise<boolean>;
}
