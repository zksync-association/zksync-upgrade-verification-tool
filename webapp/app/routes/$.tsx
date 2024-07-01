// This is called a "splat route" and as it's in the root `/app/routes/`
// directory, it's a catchall. If no other routes match, this one will and we
// can know that the user is hitting a URL that doesn't exist. By throwing a
// 404 from the loader, we can force the error boundary to render which will
// ensure the user gets the right status code and we can display a nicer error
// message for them than the Remix and/or browser default.
import { Link } from "@remix-run/react";
import { $path } from "remix-routes";

import { GeneralErrorBoundary } from "@/components/error-boundary";
import { Separator } from "@/components/ui/separator";

export function loader() {
  throw new Response("Not found", { status: 404 });
}

export default function NotFound() {
  // due to the loader, this component will never be rendered, but we'll return
  // the error boundary just in case.
  return <ErrorBoundary />;
}

export function ErrorBoundary() {
  return (
    <GeneralErrorBoundary
      statusHandlers={{
        404: () => (
          <div>
            <div className="flex items-center space-x-4">
              <h1 className="text-3xl font-semibold md:text-5xl">404</h1>
              <Separator orientation="vertical" className="h-20 bg-border" />
              <p>Page not found</p>
            </div>
            <div className="mt-10 text-center">
              <Link to={$path("/")} className="text-body-md underline">
                Go back to the home page
              </Link>
            </div>
          </div>
        ),
      }}
    />
  );
}
