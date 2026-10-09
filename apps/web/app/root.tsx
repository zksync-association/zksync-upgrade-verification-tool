import { appStatus } from "@/.server/status";
import AppShell, { StatusProblem } from "@/components/app-shell";
import { AppLoading } from "@/components/app-loading";
import { GeneralErrorBoundary } from "@/components/error-boundary";
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

export async function loader({ request }: LoaderFunctionArgs) {
  const cookies = request.headers.get("Cookie");
  const wagmiCookie = cookies ? parseWagmiCookie(cookies, "wagmi.store") : undefined;
  return defer({ env: clientEnv, wagmiCookie, status: appStatus() });
}

export type RootLoader = typeof loader;

// After Refresh, a settings save, a request from the app (signing, a mined transaction, the log
// index finishing) or once the status in hand is 30 s old; not on every navigation (revalidation.ts).
export const shouldRevalidate: ShouldRevalidateFunction = shouldRevalidateRoot;

export default function App() {
  const nonce = useNonce();
  const { env, wagmiCookie, status } = useLoaderData<typeof loader>();
  const initialState = wagmiCookie
    ? deserializeWagmiCookie<{ state: State }>(wagmiCookie).state
    : undefined;

  return (
    <Document nonce={nonce} env={env} allowIndexing={env.ALLOW_INDEXING}>
      <Suspense fallback={<AppLoading />}>
        <Await resolve={status}>
          {(status) =>
            status.ok ? (
              <WalletProvider
                initialState={initialState}
                projectId={env.WALLET_CONNECT_PROJECT_ID}
                safeWalletOrigins={env.SAFE_WALLET_ORIGINS}
                chainId={status.governance.network.chainId}
                chainLabel={status.governance.network.label}
              >
                <AppShell status={status}>
                  <Outlet />
                </AppShell>
              </WalletProvider>
            ) : (
              <StatusProblem error={status.error} hint={status.hint} />
            )
          }
        </Await>
      </Suspense>
    </Document>
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
