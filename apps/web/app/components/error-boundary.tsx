import { Separator } from "@/components/ui/separator";
import {
  type ErrorResponse,
  Link,
  isRouteErrorResponse,
  useInRouterContext,
  useParams,
  useRouteError,
} from "@remix-run/react";
import { $path } from "remix-routes";
import { useEffect } from "react";
import { recoverRouter } from "@/utils/router-recovery";

type StatusHandler = (info: {
  error: ErrorResponse;
  params: Record<string, string | undefined>;
}) => JSX.Element | null;

type BoundaryProps = {
  defaultStatusHandler?: StatusHandler;
  statusHandlers?: Record<number, StatusHandler>;
  unexpectedErrorHandler?: (error: unknown) => JSX.Element | null;
};

export function GeneralErrorBoundary(props: BoundaryProps) {
  const inRouter = useInRouterContext();
  // A failed hydration or stale development module can render this outside the router.
  // Route hooks and Link would throw again and hide the original failure.
  if (!inRouter) return <RouterRecovery />;
  return <RouteErrorBoundary {...props} />;
}

function RouterRecovery() {
  useEffect(() => {
    recoverRouter(window);
  }, []);
  return (
    <div className="mx-auto max-w-xl space-y-4 px-6 py-12" role="alert">
      <h1 className="text-2xl">The page could not load</h1>
      <p>
        Reload the page to reconnect. If the problem continues, return to the home page and try
        again.
      </p>
      <div className="flex gap-4">
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="font-semibold text-brand-600 underline"
        >
          Reload page
        </button>
        <a href="/" className="text-brand-600 underline">
          Go to home page
        </a>
      </div>
    </div>
  );
}

function RouteErrorBoundary({
  defaultStatusHandler = ({ error }) => (
    <div>
      <div className="flex items-center space-x-4">
        <h1 className="font-semibold text-3xl md:text-5xl">{error.status}</h1>
        <Separator orientation="vertical" className="h-20 bg-border" />
        <p>{error.data}</p>
      </div>
      <div className="mt-10 text-center">
        <Link to={$path("/")} className="text-body-md underline">
          Go back to the home page
        </Link>
      </div>
    </div>
  ),
  statusHandlers,
  unexpectedErrorHandler = defaultErrorHandler,
}: BoundaryProps) {
  const error = useRouteError();
  const params = useParams();

  if (typeof document !== "undefined") {
    console.error(error);
  }

  return (
    <div className="container flex min-h-screen items-center justify-center p-20 text-h2">
      {isRouteErrorResponse(error)
        ? (statusHandlers?.[error.status] ?? defaultStatusHandler)({
            error,
            params,
          })
        : unexpectedErrorHandler(error)}
    </div>
  );
}

function defaultErrorHandler() {
  return (
    <div>
      <div className="flex items-center space-x-4">
        <h1 className="font-semibold text-3xl md:text-5xl">500</h1>
        <Separator orientation="vertical" className="h-20 bg-border" />
        <p>Unexpected error</p>
      </div>
      <div className="mt-10 text-center">
        <Link to={$path("/")} className="text-body-md underline">
          Go back to the home page
        </Link>
      </div>
    </div>
  );
}
