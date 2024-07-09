import { Separator } from "@/components/ui/separator";
import {
  type ErrorResponse,
  Link,
  isRouteErrorResponse,
  useParams,
  useRouteError,
} from "@remix-run/react";
import { $path } from "remix-routes";

type StatusHandler = (info: {
  error: ErrorResponse;
  params: Record<string, string | undefined>;
}) => JSX.Element | null;

export function GeneralErrorBoundary({
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
}: {
  defaultStatusHandler?: StatusHandler;
  statusHandlers?: Record<number, StatusHandler>;
  unexpectedErrorHandler?: (error: unknown) => JSX.Element | null;
}) {
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
