import { KeepScrollOnReload } from "@/components/keep-scroll";
import { act, render } from "@testing-library/react";
import {
  RouterProvider,
  ScrollRestoration,
  createMemoryRouter,
  useRevalidator,
} from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A page that reads its data again in place stays where the reader scrolled while the read ran:
// React Router alone scrolls back to where the page was when the read started.

let y = 0;
beforeEach(() => {
  y = 0;
  Object.defineProperty(window, "scrollY", { configurable: true, get: () => y });
  // A browser reports a scroll in a later task, never inside scrollTo.
  vi.spyOn(window, "scrollTo").mockImplementation(((_x: number, to: number) => {
    y = to;
    setTimeout(() => window.dispatchEvent(new Event("scroll")));
  }) as typeof window.scrollTo);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const readerScrolls = (to: number) => {
  y = to;
  window.dispatchEvent(new Event("scroll"));
};

// React Router keeps saved positions between tests: each test is its own history entry.
let entry = 0;

function setup(keep: boolean) {
  let release = () => {};
  let reads = 0;
  let revalidate = () => {};
  function Page() {
    revalidate = useRevalidator().revalidate;
    return (
      <>
        <ScrollRestoration />
        {keep && <KeepScrollOnReload />}
      </>
    );
  }
  const router = createMemoryRouter(
    [
      {
        path: "/",
        loader: () => {
          if (reads++ === 0) return null;
          return new Promise((r) => {
            release = () => r(null);
          });
        },
        element: <Page />,
      },
    ],
    { initialEntries: [{ pathname: "/", key: `entry-${++entry}` }] }
  );
  render(<RouterProvider router={router} />);
  return {
    reload: () => act(() => revalidate()),
    finish: () => act(async () => release()),
  };
}

describe("a reload in place", () => {
  it("keeps the page where the reader scrolled while it was read", async () => {
    const page = setup(true);
    await act(async () => {});
    readerScrolls(300);
    await page.reload();
    readerScrolls(900);
    await page.finish();
    expect(window.scrollY).toBe(900);
  });

  it("(without it, React Router puts the page back where the read started)", async () => {
    const page = setup(false);
    await act(async () => {});
    readerScrolls(300);
    await page.reload();
    readerScrolls(900);
    await page.finish();
    expect(window.scrollY).toBe(300);
  });
});
