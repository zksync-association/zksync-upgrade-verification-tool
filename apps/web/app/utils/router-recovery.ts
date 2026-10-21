const RECOVERY_KEY = "governance:router-recovery";

/** Recover stale development modules once per URL per tab; never reload in a loop. */
export function recoverRouter(browser: {
  sessionStorage: Storage;
  location: Pick<Location, "pathname" | "search" | "reload">;
}) {
  if (!import.meta.env.DEV) return;
  try {
    const url = browser.location.pathname + browser.location.search;
    const attempted = JSON.parse(browser.sessionStorage.getItem(RECOVERY_KEY) ?? "[]");
    if (!Array.isArray(attempted) || attempted.includes(url)) return;
    browser.sessionStorage.setItem(RECOVERY_KEY, JSON.stringify([...attempted, url]));
    browser.location.reload();
  } catch {
    // Storage may be blocked by browser privacy settings. Keep manual recovery available.
  }
}
