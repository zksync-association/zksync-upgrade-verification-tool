// Read-only app benchmark. Local refresh only invalidates caches; no wallet is connected.
import { writeFile } from "node:fs/promises";
import { webkit } from "../packages/e2e/node_modules/@playwright/test/index.mjs";

const base = process.env.BENCHMARK_URL ?? "http://127.0.0.1:3000";
const status = await fetch(`${base}/api/status`).then((r) => r.json());
if (
  !status.ok ||
  status.governance.warnings.length ||
  status.governance.network.overrides.length ||
  status.logHistory.status !== "ok"
)
  throw new Error("Governance trust status needs review; stopped.");
await fetch(`${base}/resources/refresh`, { method: "POST" });
const browser = await webkit.launch({ headless: true });
const page = await browser.newPage();
const results = [];
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  for (const [route, heading] of [
    ["/", "Governance review"],
    ["/settings", "Settings"],
    ["/app/proposals", "Protocol upgrades"],
  ]) {
    const start = performance.now();
    await page.goto(`${base}${route}`, { waitUntil: "commit", timeout: 90000 });
    await page
      .getByRole("heading", { name: new RegExp(`^(Reading governance data…|${heading})$`) })
      .first()
      .waitFor({ timeout: 90000 });
    const firstContentMs = performance.now() - start;
    await page.getByRole("heading", { name: heading, exact: true }).waitFor({ timeout: 90000 });
    const visibleMs = performance.now() - start;
    await page.waitForFunction(() => window.__remixRouter?.state?.initialized, { timeout: 90000 });
    const hydratedMs = performance.now() - start;
    results.push({ route, firstContentMs, visibleMs, hydratedMs });
    console.log(JSON.stringify(results.at(-1)));
  }
  for (const [link, heading] of [
    ["Settings", "Settings"],
    ["Upgrades", "Protocol upgrades"],
    ["Emergency", "Emergency upgrades"],
  ]) {
    const target = page.getByRole("navigation").getByRole("link", { name: link, exact: true });
    await target.hover();
    await page.waitForTimeout(300);
    const start = performance.now();
    await target.click();
    await page.getByRole("heading", { name: heading, exact: true }).waitFor();
    results.push({ navigation: link, visibleMs: performance.now() - start });
    console.log(JSON.stringify(results.at(-1)));
  }
} finally {
  await browser.close();
  await writeFile(
    process.env.BENCHMARK_OUTPUT ?? ".cache/local/performance-after.json",
    JSON.stringify({ results, errors }, null, 2)
  );
}
