// node:path (posix) for the single-file build, as the chain cache uses it: its files live in
// IndexedDB under these paths (shims/fs.ts).
const CWD = "/app";
const normalize = (path: string) => {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return `/${out.join("/")}`;
};
export const join = (...parts: string[]) => normalize(parts.join("/"));
export const resolve = (...parts: string[]) => {
  let path = CWD;
  for (const part of parts) path = part.startsWith("/") ? part : `${path}/${part}`;
  return normalize(path);
};
export const dirname = (path: string) => normalize(`${path}/..`);
export const basename = (path: string) => normalize(path).split("/").pop() ?? "";
export default { join, resolve, dirname, basename };
