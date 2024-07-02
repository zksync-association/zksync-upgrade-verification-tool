import { GeneralErrorBoundary } from "@/components/error-boundary";
import { useNonce } from "@/utils/nonce-provider";
import { clientEnv } from "@config/env.server";
import { type LoaderFunctionArgs, json } from "@remix-run/node";
import { Links, Meta, Outlet, Scripts, ScrollRestoration, useLoaderData } from "@remix-run/react";

import { WalletProvider, web3ModalConfig } from "@/components/providers/wallet-provider";
import { cookieToInitialState } from "wagmi";

import "@/globals.css";
import "@rainbow-me/rainbowkit/styles.css";

export function loader({ request }: LoaderFunctionArgs) {
  const cookies = request.headers.get("Cookie");
  return json({ env: clientEnv, cookies });
}

export default function App() {
  const nonce = useNonce();
  const { env, cookies } = useLoaderData<typeof loader>();
  const initialState = cookieToInitialState(
    web3ModalConfig(env.WALLET_CONNECT_PROJECT_ID),
    cookies
  );

  return (
    <Document nonce={nonce} env={env} allowIndexing={env.ALLOW_INDEXING}>
      <WalletProvider initialState={initialState} projectId={env.WALLET_CONNECT_PROJECT_ID}>
        <Outlet />
      </WalletProvider>
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
  env?: typeof clientEnv;
  allowIndexing?: boolean;
}) {
  return (
    <html lang="en" className="dark flex justify-center">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {allowIndexing ? null : <meta name="robots" content="noindex, nofollow" />}
        <Meta />
        <Links />
      </head>
      <body className="relative min-h-screen max-w-screen-md">
        {children}
        <script
          nonce={nonce}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: <explanation>
          dangerouslySetInnerHTML={{
            __html: `window.ENV = ${JSON.stringify(env)}`,
          }}
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
      <GeneralErrorBoundary />
    </Document>
  );
}
