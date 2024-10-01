import { useRouteError } from "@remix-run/react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ErrorBoundary } from "@/routes/$";

vi.mock("@remix-run/react", async () => {
  const actual = await vi.importActual("@remix-run/react");
  return {
    ...actual,
    useRouteError: vi.fn(),
    useParams: vi.fn(() => ({})),
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
      <a href={to}>{children}</a>
    ),
  };
});

vi.mock("remix-routes", () => ({
  $path: () => "/",
}));

describe("ErrorBoundary", () => {
  it("renders default error handler for unexpected errors", () => {
    vi.mocked(useRouteError).mockReturnValue(new Error("Unexpected error"));

    render(<ErrorBoundary />);

    expect(screen.getByText("500")).toBeInTheDocument();
    expect(screen.getByText("Unexpected error")).toBeInTheDocument();
    expect(screen.getByText("Go back to the home page")).toBeInTheDocument();
  });
});
