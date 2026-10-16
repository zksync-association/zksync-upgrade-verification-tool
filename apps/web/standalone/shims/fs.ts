// node:fs/promises for the single-file build: the chain cache's files in this browser's IndexedDB
// (one database, one store, keyed by path). Only what chain-cache.ts uses.
const DB = "zksync-governance-verifier";
const STORE = "files";
let opened: Promise<IDBDatabase> | null = null;
function db() {
  if (!opened)
    opened = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  return opened;
}
async function tx<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const store = (await db()).transaction(STORE, mode).objectStore(STORE);
  return new Promise((resolve, reject) => {
    const request = work(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
const codeError = (code: string, path: string) =>
  Object.assign(new Error(`${code}: ${path}`), { code });
const get = (path: string) =>
  tx<string | undefined>("readonly", (s) => s.get(path) as IDBRequest<string | undefined>);

export async function readFile(path: string, _encoding?: string) {
  const text = await get(path);
  if (text === undefined) throw codeError("ENOENT", path);
  return text;
}
export async function writeFile(path: string, data: string, options?: { flag?: string }) {
  if (options?.flag === "wx" && (await get(path)) !== undefined) throw codeError("EEXIST", path);
  await tx("readwrite", (s) => s.put(data, path));
}
export async function rename(from: string, to: string) {
  const text = await readFile(from);
  await tx("readwrite", (s) => s.put(text, to));
  await tx("readwrite", (s) => s.delete(from));
}
export async function rm(path: string, options?: { force?: boolean }) {
  if (!options?.force && (await get(path)) === undefined) throw codeError("ENOENT", path);
  await tx("readwrite", (s) => s.delete(path));
}
export async function stat(path: string) {
  const text = await readFile(path);
  return {
    size: new TextEncoder().encode(text).length,
    isFile: () => true,
    isDirectory: () => false,
  };
}
export async function readdir(dir: string) {
  const prefix = dir.endsWith("/") ? dir : `${dir}/`;
  const keys = (await tx<IDBValidKey[]>("readonly", (s) => s.getAllKeys())) as string[];
  return keys
    .filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes("/"))
    .map((k) => k.slice(prefix.length));
}
export async function mkdir() {}
export async function chmod() {}
export default { readFile, writeFile, rename, rm, stat, readdir, mkdir, chmod };
