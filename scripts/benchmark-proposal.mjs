// Read-only WebKit check of clicking the actual proposal from the proposal list.
import { mkdir, writeFile } from "node:fs/promises";
import { webkit } from "../packages/e2e/node_modules/@playwright/test/index.mjs";
const base = "http://127.0.0.1:3000";
const id = "0x77d5461c37515d627820ab6573efe63fb0b253cf83308dbb368b859e9835eaaa";
const status = await fetch(`${base}/api/status`).then((r) => r.json());
if (
  !status.ok ||
  status.governance.warnings.length ||
  status.governance.network.overrides.length ||
  status.logHistory.status !== "ok"
)
  throw Error("Trust status needs review; stopped");
await mkdir(".cache/local/proposal-streaming", { recursive: true });
const browser = await webkit.launch({ headless: true });
const results = [];
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${base}/app/proposals`, {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });
    const target = page.locator(`a[href="/app/proposals/${id}"]`);
    await target.waitFor({ timeout: 90000 });
    const start = performance.now();
    await target.click();
    await page.getByTestId("id-check").waitFor({ timeout: 90000 });
    const overviewMs = Math.round(performance.now() - start);
    const pending = await page.getByRole("status").allTextContents();
    await page.screenshot({ path: `.cache/local/proposal-streaming/${width}.png`, fullPage: true });
    await page.getByTestId("set-securityCouncil").waitFor({ timeout: 90000 });
    for (const text of [
      "Finding the L2 vote…",
      "Finding the execution transaction…",
      "Reading recorded approvals and re-checking their historical signatures…",
    ])
      await page.getByText(text, { exact: true }).waitFor({ state: "hidden", timeout: 90000 });
    const result = {
      width,
      overviewMs,
      completeMs: Math.round(performance.now() - start),
      pending,
      errors,
    };
    results.push(result);
    console.log(JSON.stringify(result));
    await page.close();
  }
} finally {
  await browser.close();
  await writeFile(".cache/local/proposal-streaming.json", JSON.stringify(results, null, 2));
}
