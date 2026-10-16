// The pages' loaders and actions were written for a server on this machine: they read the request's
// URL and its Origin / Sec-Fetch-Site headers (settings and beats are accepted only from this app's
// own pages). In the single-file build every call is the page's own, so each one is shown to them as
// a same-origin request to 127.0.0.1 with the same path and query.
export const LOCAL = "http://127.0.0.1:3000";

export function localRequest(request: Request, path?: string): Request {
  const original = new URL(request.url);
  const url = `${LOCAL}${path ?? original.pathname}${original.search}`;
  const headers = new Headers(request.headers);
  headers.set("origin", LOCAL);
  headers.set("sec-fetch-site", "same-origin");
  headers.set("host", "127.0.0.1:3000");
  return new Proxy(request, {
    get(target, property) {
      if (property === "url") return url;
      if (property === "headers") return headers;
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
