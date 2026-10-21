import { GeneralErrorBoundary } from "@/components/error-boundary";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

vi.mock("@/utils/router-recovery", () => ({ recoverRouter: vi.fn() }));

it("provides recovery outside router context instead of throwing a second error", () => {
  render(<GeneralErrorBoundary />);
  expect(screen.getByRole("alert")).toHaveTextContent("The page could not load");
  expect(screen.getByRole("button", { name: "Reload page" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Go to home page" })).toHaveAttribute("href", "/");
});
