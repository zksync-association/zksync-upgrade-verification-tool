import Logo from "@/components/logo";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

describe("Logo component", () => {
  it("renders the logo image", () => {
    render(<Logo />);
    const logoImage = screen.getByAltText("Zksync Logo");
    expect(logoImage).toBeInTheDocument();
    expect(logoImage).toHaveAttribute("src", expect.stringContaining("zksync"));
  });

  it("applies custom className when provided", () => {
    const customClass = "custom-logo-class";
    render(<Logo className={customClass} />);
    const logoImage = screen.getByAltText("Zksync Logo");
    expect(logoImage).toHaveClass(customClass);
  });
});
