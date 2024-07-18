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
import ConnectRedirectProvider from "@/components/providers/connect-redirect-provider";

export const links: LinksFunction = () => [
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap",
  },
];

export async function loader({ request }: LoaderFunctionArgs) {
  // Get wagmi cookie for SSR
  const cookies = request.headers.get("Cookie");
  const wagmiCookie = cookies ? parseWagmiCookie(cookies, "wagmi.store") : undefined;
  return json({ env: clientEnv, wagmiCookie });
}

export default function App() {
  const nonce = useNonce();
  const { env, wagmiCookie } = useLoaderData<typeof loader>();

  const walletProviderInitialState = wagmiCookie
    ? deserializeWagmiCookie<{ state: State }>(wagmiCookie).state
    : undefined;

  return (
    <Document nonce={nonce} env={env} allowIndexing={env.ALLOW_INDEXING}>
      <WalletProvider
        initialState={walletProviderInitialState}
        projectId={env.WALLET_CONNECT_PROJECT_ID}
        devNetwork={env.NODE_ENV === "development"}
      >
        <ConnectRedirectProvider>
          <div className="flex min-h-screen flex-col px-10 py-10 lg:px-40">
            <Outlet />
          </div>
        </ConnectRedirectProvider>
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
  env?: CLIENT_ENV;
  allowIndexing?: boolean;
}) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {allowIndexing ? null : <meta name="robots" content="noindex, nofollow" />}
        <Meta />
        <Links />
      </head>
      <body>
        <div className="relative mx-auto min-h-screen w-full max-w-[1500px]">{children}</div>
        <Toaster position="bottom-center" />
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
