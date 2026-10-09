// Read-only WebKit check: emergency details stream before current Safe verification.
import { mkdir, writeFile } from "node:fs/promises";
import { webkit } from "../packages/e2e/node_modules/@playwright/test/index.mjs";
const base = "http://127.0.0.1:3000";
const id = "0xb1660380be18f4cf30cb1a253d3e91da3e584ca7ae82d7d6fd9675a722d6da5e";
const status = await fetch(`${base}/api/status`).then((r) => r.json());
if (
  !status.ok ||
  status.governance.warnings.length ||
  status.governance.network.overrides.length ||
  status.logHistory.status !== "ok"
)
  throw new Error("Trust status needs review; stopped");
await fetch(`${base}/resources/refresh`, { method: "POST" });
await mkdir(".cache/local/emergency-streaming", { recursive: true });
const browser = await webkit.launch({ headless: true });
const results = [];
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({
      viewport: { width, height: 1000 },
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const start = performance.now();
    await page.goto(`${base}/app/emergency/${id}`, {
      waitUntil: "commit",
      timeout: 90000,
    });
    await page.getByText("Executed", { exact: true }).first().waitFor({ timeout: 90000 });
    const overviewMs = Math.round(performance.now() - start);
    await page.getByTestId("id-check").waitFor({ timeout: 90000 });
    const callsMs = Math.round(performance.now() - start);
    const pending = await page.getByRole("status").allTextContents();
    await page.screenshot({
      path: `.cache/local/emergency-streaming/${width}.png`,
      fullPage: true,
    });
    await page.getByTestId("set-securityCouncil").waitFor({ timeout: 90000 });
    const completeMs = Math.round(performance.now() - start);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    const listStart = performance.now();
    await page.goto(`${base}/app/emergency`, { waitUntil: "commit", timeout: 90000 });
    await page
      .getByRole("heading", { name: "Emergency upgrades", exact: true })
      .waitFor({ timeout: 90000 });
    await page
      .getByText("Reading recent emergency executions…", { exact: true })
      .waitFor({ state: "hidden", timeout: 90000 });
    await page
      .getByText("Collecting emergency signatures from members' Safes…", { exact: true })
      .waitFor({ state: "hidden", timeout: 90000 });
    const result = {
      width,
      overviewMs,
      callsMs,
      completeMs,
      listMs: Math.round(performance.now() - listStart),
      pending,
      overflow,
      errors,
    };
    if (errors.length || overflow) throw new Error(JSON.stringify(result));
    results.push(result);
    console.log(JSON.stringify(result));
    await page.close();
  }
} finally {
  await browser.close();
  await writeFile(".cache/local/emergency-streaming.json", JSON.stringify(results, null, 2));
}
