// The single-file build has no Remix server: its pages run on React Router's data router, which
// Remix's client APIs come from. Remix's document-only components render nothing here.
export * from "react-router-dom";
export const Links = () => null;
export const Meta = () => null;
export const Scripts = () => null;
export const LiveReload = () => null;
export function RemixBrowser(): never {
  throw new Error("RemixBrowser is not used in the single-file build");
}
