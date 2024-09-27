import type { Page } from "@playwright/test";

export async function goToFreezeIndex(page: Page) {
  await page.goto("/");
  await page.getByText("Freeze Requests").click();
  await page.getByText("Soft Freeze Proposals", { exact: true }).isVisible();
}

export async function createFreeze(
  page: Page,
  kind: "SOFT_FREEZE" | "HARD_FREEZE" | "UNFREEZE"
): Promise<void>;
export async function createFreeze(
  page: Page,
  kind: "SET_SOFT_FREEZE_THRESHOLD",
  threshold: number
): Promise<void>;
export async function createFreeze(
  page: Page,
  kind: "SOFT_FREEZE" | "HARD_FREEZE" | "UNFREEZE" | "SET_SOFT_FREEZE_THRESHOLD",
  threshold?: number
) {
  await goToFreezeIndex(page);
  await page.getByTestId("create-freeze-btn").click();
  await page.getByRole("combobox").click();

  let label: string;
  switch (kind) {
    case "SOFT_FREEZE":
      label = "Soft Freeze";
      break;
    case "HARD_FREEZE":
      label = "Hard Freeze";
      break;
    case "SET_SOFT_FREEZE_THRESHOLD":
      label = "Set Soft Freeze Threshold";
      break;
    case "UNFREEZE":
      label = "Unfreeze";
      break;
  }
  await page.getByLabel(label, { exact: true }).click();

  if (kind === "SET_SOFT_FREEZE_THRESHOLD") {
    if (!threshold) throw new Error("Threshold is required for SET_SOFT_FREEZE_THRESHOLD");
    await page.getByLabel("Threshold").fill(threshold.toString());
  }

  await page.getByRole("button", { name: "Create" }).click();
}
