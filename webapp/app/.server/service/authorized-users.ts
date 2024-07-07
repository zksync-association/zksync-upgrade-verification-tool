export async function isUserAuthorized(address: string) {
  return new Promise((resolve, _) => setTimeout(() => resolve(true), 1000)) as Promise<boolean>;
}
