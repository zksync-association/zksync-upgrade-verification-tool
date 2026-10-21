// The site's root for the single-file build: the same loader and page frame as app/root.tsx, without
// the <html> document (this page is already one). Until an RPC URL is saved only the settings show.
import { AppBody, AppToaster, loader as appLoader, shouldRevalidate } from "@/root";
import { GeneralErrorBoundary } from "@/components/error-boundary";
import { Navigate, Outlet, ScrollRestoration, useLocation } from "react-router-dom";
import { hasRpcSetting } from "./shims/local-settings";

export { shouldRevalidate };
// Until an RPC URL is saved nothing is read: the settings page needs none of the root's data.
export const loader = (args: Parameters<typeof appLoader>[0]) =>
  hasRpcSetting() ? appLoader(args) : { unconfigured: true };

export default function Root() {
  const { pathname } = useLocation();
  if (!hasRpcSetting()) {
    if (pathname !== "/settings") return <Navigate to="/settings" replace />;
    return (
      <div className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="mb-2 font-semibold text-2xl">ZKsync governance verifier</h1>
        <p className="mb-8 text-muted-foreground">
          Everything runs in this browser: it reads only from the RPC and Safe service you enter
          below. They are kept in this browser's storage, nowhere else.
        </p>
        <Outlet />
      </div>
    );
  }
  return (
    <>
      <AppBody />
      <AppToaster />
      {/* Back and forward land where each page was scrolled to (Settings' close button is a back). */}
      <ScrollRestoration />
    </>
  );
}

export function ErrorBoundary() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-24">
      <GeneralErrorBoundary />
    </div>
  );
}
