import { useSyncExternalStore } from "react";

// Whether this tab is visible (document.visibilityState): what a page may keep asking the server
// for while it is. A hidden tab (another tab in front, a minimized window, a locked screen in most
// browsers) asks for nothing, so the app can stop following the chain (sync/presence.ts).

function subscribe(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

/** The tab is visible; true on the server and before hydration. */
export function useDocumentVisible(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => document.visibilityState === "visible",
    () => true
  );
}
