import { useLocation, useRevalidator } from "@remix-run/react";
import { useEffect, useLayoutEffect, useRef } from "react";

/**
 * Rendered after <ScrollRestoration>: a page that reads its data again in place (a revalidation,
 * e.g. when what it shows changed) stays where the reader has it. React Router scrolls back to
 * where the page was when the read started, which moves a page scrolled while the read was slow.
 */
export function KeepScrollOnReload() {
  const { key } = useLocation();
  const { state } = useRevalidator();
  const y = useRef<number | null>(null);
  // The page being read again, until its read ends.
  const reloading = useRef<string | null>(null);
  useEffect(() => {
    const onScroll = () => {
      y.current = window.scrollY;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useLayoutEffect(() => {
    if (state === "loading") {
      reloading.current ??= key;
      return;
    }
    const samePage = reloading.current === key;
    reloading.current = null;
    if (samePage && y.current !== null && window.scrollY !== y.current) {
      window.scrollTo(0, y.current);
    }
  }, [state, key]);
  return null;
}
