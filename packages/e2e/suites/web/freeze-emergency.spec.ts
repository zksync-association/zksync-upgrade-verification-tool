import { expect, test } from "@playwright/test";
import { type Address, getAddress } from "viem";
import { COUNCIL, buildTypedData, refreshApp, resetAll, signInSafe } from "./support";

test.beforeEach(async () => {
  await resetAll();
});

test("a new freeze request is just a URL until members sign it in their Safes", async ({
  page,
}) => {
  await page.goto("/app/freeze");
  await page.getByTestId("new-freeze").click();
  await page.getByRole("dialog").getByRole("button", { name: "Open request page" }).click();
  await expect(page).toHaveURL(/\/app\/freeze\/soft-freeze\?nonce=0&validUntil=\d+/);
  const set = page.getByTestId("set-freeze");
  await expect(set.getByTestId("signature-count")).toHaveText("0 / 3");

  const validUntil = new URL(page.url()).searchParams.get("validUntil") as string;
  const typedData = buildTypedData(
    "SoftFreeze",
    { name: "SecurityCouncil", version: "1", chainId: 1, verifyingContract: COUNCIL },
    { nonce: "0", validUntil }
  );
  const members: Address[] = [
    "0x34Ea62D4b9bBB8AD927eFB6ab31E3Ab3474aC93a",
    "0x35eA56fd9eAd2567F339Eb9564B6940b9DD5653F",
    "0x69462a81ba94D64c404575f1899a464F123497A2",
  ];
  for (const m of members) await signInSafe(getAddress(m), typedData);
  await refreshApp();
  await page.reload();
  await expect(set.getByTestId("signature-count")).toHaveText("3 / 3");
  await expect(set.getByTestId("threshold-met")).toBeVisible();
  await expect(set.getByTestId("simulation-ok")).toBeVisible();
});

test("an emergency payload is built, hashed and checked in the browser", async ({ page }) => {
  await page.goto("/app/emergency/new");
  await page.getByPlaceholder("Target address").fill("0x000000000000000000000000000000000000dEaD");
  await page.getByRole("button", { name: "Continue to signing" }).click();
  await expect(page).toHaveURL(/\/app\/emergency\/0x[0-9a-f]{64}$/);
  await expect(page.getByTestId("payload-ok")).toContainText("The payload hashes to this id");
  await expect(page.getByTestId("set-securityCouncil").getByTestId("signature-count")).toHaveText(
    "0 / 6"
  );

  // The pending, fully signed id on mainnet: a payload for anything else is refused.
  await page.goto(
    "/app/emergency/0x4fa238865a64c1ccc992bfc0a4e984d13443e0e87c67feddb3cedc6f20f59f59"
  );
  await page.getByLabel("Paste the payload JSON").fill(
    JSON.stringify({
      salt: `0x${"00".repeat(32)}`,
      calls: [{ target: "0x000000000000000000000000000000000000dEaD", value: "0", data: "0x" }],
    })
  );
  await page.getByTestId("check-payload").click();
  await expect(page.getByTestId("payload-error")).toContainText("not to the signed id");
  await expect(page.getByTestId("set-securityCouncil").getByTestId("threshold-met")).toBeVisible();
});
