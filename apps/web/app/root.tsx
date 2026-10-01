import { appStatus } from "@/.server/status";
import AppShell, { StatusProblem } from "@/components/app-shell";
import { GeneralErrorBoundary } from "@/components/error-boundary";
import { WalletProvider } from "@/components/providers/wallet-provider";
import { useNonce } from "@/utils/nonce-provider";
import { type CLIENT_ENV, clientEnv } from "@config/env.server";
import { type LinksFunction, type LoaderFunctionArgs, json } from "@remix-run/node";
import { Links, Meta, Outlet, Scripts, ScrollRestoration, useLoaderData } from "@remix-run/react";
import { Toaster } from "react-hot-toast";
import {
  type State,
  deserialize as deserializeWagmiCookie,
  parseCookie as parseWagmiCookie,
} from "wagmi";

import "@/globals.css";
import "@rainbow-me/rainbowkit/styles.css";

export const links: LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;800&family=JetBrains+Mono:wght@400;500&display=swap",
  },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const cookies = request.headers.get("Cookie");
  const wagmiCookie = cookies ? parseWagmiCookie(cookies, "wagmi.store") : undefined;
  return json({ env: clientEnv, wagmiCookie, status: await appStatus() });
}

export type RootLoader = typeof loader;

export default function App() {
  const nonce = useNonce();
  const { env, wagmiCookie, status } = useLoaderData<typeof loader>();
  const initialState = wagmiCookie
    ? deserializeWagmiCookie<{ state: State }>(wagmiCookie).state
    : undefined;

  return (
    <Document nonce={nonce} env={env} allowIndexing={env.ALLOW_INDEXING}>
      {status.ok ? (
        <WalletProvider
          initialState={initialState}
          projectId={env.WALLET_CONNECT_PROJECT_ID}
          chainId={status.governance.network.chainId}
          chainLabel={status.governance.network.label}
        >
          <AppShell status={status}>
            <Outlet />
          </AppShell>
        </WalletProvider>
      ) : (
        <StatusProblem error={status.error} hint={status.hint} />
      )}
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
      <body className="min-h-screen bg-slate-50">
        {children}
        <Toaster position="bottom-center" toastOptions={{ className: "!rounded-xl !text-sm" }} />
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
