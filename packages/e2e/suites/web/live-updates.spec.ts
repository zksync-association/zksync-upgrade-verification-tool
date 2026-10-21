import { expect, test } from "@playwright/test";
import {
  COUNCIL,
  UNSIGNED_MEMBER,
  UPGRADE_ID,
  buildTypedData,
  resetAll,
  signInSafe,
} from "./support";

// An open page updates itself: while it is on screen the app asks the member Safes of a set that
// can still be signed about new signatures (every 3 s here: SYNC_SAFE_WATCH_MS in global setup),
// and the tab, told by its next beat that what it shows changed, reloads its data in place. The
// "Fetch signatures" button reads them at once. Here the Security Council's last member signs in
// its Safe (the mock Safe API) while the upgrade's page stays open, never navigated.

const approval = () =>
  buildTypedData(
    "ApproveUpgradeSecurityCouncil",
    { name: "SecurityCouncil", version: "1", chainId: 1, verifyingContract: COUNCIL },
    { id: UPGRADE_ID }
  );

test.beforeEach(async () => {
  await resetAll();
});

test("a signature filed in Safe appears on the open page without navigating", async ({ page }) => {
  await page.goto(`/app/proposals/${UPGRADE_ID}`);
  const council = page.getByTestId("set-securityCouncil");
  const row = council.getByTestId("member-row").filter({ hasText: "OpenZeppelin" });
  await expect(row).toHaveAttribute("data-status", "missing");
  // The set says how its copies are kept.
  await expect(council.getByTestId("set-freshness")).toContainText("Safe checked");
  const navigations: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) navigations.push(frame.url());
  });
  // Scroll and an expanded member row survive the update.
  await council.getByText("What members sign").click();
  const scroll = await page.evaluate(() => {
    window.scrollTo(0, 600);
    return window.scrollY;
  });

  await signInSafe(UNSIGNED_MEMBER, approval());
  // Within the watcher's cadence and a beat (10 s), without a navigation or a click.
  await expect(row).toHaveAttribute("data-status", "valid", { timeout: 30_000 });
  await expect(council.getByTestId("signature-count")).toHaveText("8 signatures · 4 required");
  expect(navigations).toEqual([]);
  await expect(council.getByText("EIP-712 digest")).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(scroll);
});

test("Fetch signatures shows a signature filed in Safe at once", async ({ page }) => {
  await page.goto(`/app/proposals/${UPGRADE_ID}`);
  const council = page.getByTestId("set-securityCouncil");
  const row = council.getByTestId("member-row").filter({ hasText: "OpenZeppelin" });
  await expect(row).toHaveAttribute("data-status", "missing");
  await signInSafe(UNSIGNED_MEMBER, approval());
  // The press itself: its request reads the set's Safes now and answers the new revision...
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/resources/safe-check") && r.request().method() === "POST"
    ),
    council.getByTestId("fetch-signatures").click(),
  ]);
  expect(response.ok()).toBe(true);
  const answer = (await response.json()) as { checked: number; failed: number; rev: string };
  expect(answer.checked).toBeGreaterThan(0);
  expect(answer.failed).toBe(0);
  const answered = Date.now();
  // ...and the page reloads in place at once: well before a beat (10 s) could have brought it.
  await expect(row).toHaveAttribute("data-status", "valid", { timeout: 10_000 });
  expect(Date.now() - answered).toBeLessThan(3_000);
  // The label says the Safes were just read, not the age from before the press (once every
  // member is valid nothing is checked any more: it gives the copies' age instead).
  await expect(council.getByTestId("set-freshness")).toContainText(
    /Safe (checked|copies from) [0-3]s ago/
  );
  await expect(council.getByTestId("fetch-signatures")).toBeEnabled();
});

test("on a phone an update in place leaves the page where it was (the header keeps its height)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // A phone's CPU: hydration is slow enough that the root status lands while the page's sections
  // are still hydrating, which must not render them again (detaching what is on screen).
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
  await page.goto(`/app/proposals/${UPGRADE_ID}`);
  const council = page.getByTestId("set-securityCouncil");
  const row = council.getByTestId("member-row").filter({ hasText: "OpenZeppelin" });
  await expect(row).toHaveAttribute("data-status", "missing");
  const button = council.getByTestId("fetch-signatures");
  await button.scrollIntoViewIfNeeded();
  const header = page.locator("header");
  const before = {
    header: (await header.boundingBox())?.height,
    button: (await button.boundingBox())?.y,
    scroll: await page.evaluate(() => window.scrollY),
  };
  await signInSafe(UNSIGNED_MEMBER, approval());
  await button.click();
  await expect(row).toHaveAttribute("data-status", "valid", { timeout: 10_000 });
  // The update and its note ("Updating…") come and go without moving anything.
  await page.waitForTimeout(1_000);
  expect((await header.boundingBox())?.height).toBe(before.header);
  expect(await page.evaluate(() => window.scrollY)).toBe(before.scroll);
  expect(
    Math.abs(((await button.boundingBox())?.y ?? 0) - (before.button ?? 0))
  ).toBeLessThanOrEqual(1);
});
