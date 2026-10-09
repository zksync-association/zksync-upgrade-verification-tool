import { appStatus, shellChain } from "@/.server/status";
import AppShell, { AppFrame, StatusProblem } from "@/components/app-shell";
import { GeneralErrorBoundary } from "@/components/error-boundary";
import { ChainContext } from "@/components/governance-context";
import { WalletProvider } from "@/components/providers/wallet-provider";
import { useNonce } from "@/utils/nonce-provider";
import { shouldRevalidateRoot } from "@/utils/revalidation";
import { type CLIENT_ENV, clientEnv } from "@config/env.server";
import { type LinksFunction, type LoaderFunctionArgs, defer } from "@remix-run/node";
import {
  Await,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  type ShouldRevalidateFunction,
  useLoaderData,
} from "@remix-run/react";
import { Suspense } from "react";
import { Toaster } from "react-hot-toast";
import {
  type State,
  deserialize as deserializeWagmiCookie,
  parseCookie as parseWagmiCookie,
} from "wagmi";

import "@/globals.css";
import "@/fonts.css";
import "@rainbow-me/rainbowkit/styles.css";

export const links: LinksFunction = () => [
  {
    rel: "preload",
    href: "/fonts/inter-latin.woff2",
    as: "font",
    type: "font/woff2",
    crossOrigin: "anonymous",
  },
];

// Nothing here waits on the network before the first bytes of the page: the status is deferred
// (the shell renders while it is read), and the chain the RPC is on is in hand once the server
// has read it (before it starts listening), else deferred too.
export function loader({ request }: LoaderFunctionArgs) {
  const cookies = request.headers.get("Cookie");
  const wagmiCookie = cookies ? parseWagmiCookie(cookies, "wagmi.store") : undefined;
  return defer({ env: clientEnv, wagmiCookie, chain: shellChain(), status: appStatus() });
}

export type RootLoader = typeof loader;

// After Refresh, a settings save, a request from the app (signing, a mined transaction, the log
// index finishing) or once the status in hand is 30 s old; not on every navigation (revalidation.ts).
export const shouldRevalidate: ShouldRevalidateFunction = shouldRevalidateRoot;

export default function App() {
  const nonce = useNonce();
  const { env, wagmiCookie, chain, status } = useLoaderData<typeof loader>();
  const initialState = wagmiCookie
    ? deserializeWagmiCookie<{ state: State }>(wagmiCookie).state
    : undefined;

  // The shell, the navigation and the page render at once; only the wallet needs the chain id
  // first (in hand unless the server has not read it yet). The status fills in as it is read.
  return (
    <Document nonce={nonce} env={env} allowIndexing={env.ALLOW_INDEXING}>
      <Suspense fallback={<AppFrame />}>
        <Await resolve={chain} errorElement={<ChainProblem status={status} />}>
          {(chain) => (
            <ChainContext.Provider value={chain}>
              <WalletProvider
                initialState={initialState}
                projectId={env.WALLET_CONNECT_PROJECT_ID}
                safeWalletOrigins={env.SAFE_WALLET_ORIGINS}
                chainId={chain.chainId}
                chainLabel={chain.label}
              >
                <AppShell status={status}>
                  <Outlet />
                </AppShell>
              </WalletProvider>
            </ChainContext.Provider>
          )}
        </Await>
      </Suspense>
    </Document>
  );
}

/** The RPC's chain could not be read: why, from the status (which failed on the same read). */
function ChainProblem({
  status,
}: { status: ReturnType<typeof useLoaderData<typeof loader>>["status"] }) {
  return (
    <Suspense fallback={<AppFrame />}>
      <Await
        resolve={status}
        errorElement={
          <StatusProblem
            error="The app could not read which chain the RPC is on."
            hint="Check L1_RPC_URL."
          />
        }
      >
        {(status) =>
          status.ok ? (
            <StatusProblem
              error="The app could not read which chain the RPC is on."
              hint="Reload the page."
            />
          ) : (
            <StatusProblem error={status.error} hint={status.hint} />
          )
        }
      </Await>
    </Suspense>
  );
}

function Document({
  children,
  nonce,
  env,
  allowIndexing,
}: {
  children: React.ReactNode;
  nonce: string;
  env?: CLIENT_ENV;
  allowIndexing?: boolean;
}) {
  return (
    <html lang="en">
      <head>
        <Meta />
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {allowIndexing ? null : <meta name="robots" content="noindex, nofollow" />}
        <Links />
      </head>
      <body className="min-h-screen bg-background text-foreground">
        {children}
        <Toaster
          position="bottom-center"
          toastOptions={{
            className: "!rounded-xl !text-sm",
            style: {
              background: "hsl(var(--popover))",
              color: "hsl(var(--popover-foreground))",
            },
          }}
        />
        <script
          nonce={nonce}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: public client env only
          dangerouslySetInnerHTML={{ __html: `window.ENV = ${JSON.stringify(env)}` }}
          suppressHydrationWarning
        />
        <ScrollRestoration nonce={nonce} />
        <Scripts nonce={nonce} />
      </body>
    </html>
  );
}

export function ErrorBoundary() {
  const nonce = useNonce();
  return (
    <Document nonce={nonce}>
      <div className="mx-auto max-w-3xl px-6 py-24">
        <GeneralErrorBoundary />
      </div>
    </Document>
  );
}
