import { GeneralErrorBoundary } from "@/components/error-boundary";
import { useNonce } from "@/utils/nonce-provider";
import { clientEnv } from "@config/env.server";
import { json } from "@remix-run/node";
import { Links, Meta, Outlet, Scripts, ScrollRestoration, useLoaderData } from "@remix-run/react";

import "@/globals.css";

export async function loader() {
  return json({ env: clientEnv });
}

export default function App() {
  const nonce = useNonce();
  const { env } = useLoaderData<typeof loader>();

  return (
    <Document nonce={nonce} env={env} allowIndexing={env.ALLOW_INDEXING}>
      <Outlet />
    </Document>
  );
}

function Document({
  children,
  nonce,
  env,
  allowIndexing,
}: { children: React.ReactNode; nonce: string; env?: typeof clientEnv; allowIndexing?: boolean }) {
  return (
    <html lang="en" className="dark">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {allowIndexing ? null : <meta name="robots" content="noindex, nofollow" />}
        <Meta />
        <Links />
      </head>
      <body className="min-h-screen">
        {children}
        <script
          nonce={nonce}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: <explanation>
          dangerouslySetInnerHTML={{
            __html: `window.ENV = ${JSON.stringify(env)}`,
          }}
        />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export function ErrorBoundary() {
  return <GeneralErrorBoundary />;
}
