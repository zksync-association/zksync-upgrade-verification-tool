import { type Address, getAddress } from "viem";
import { COUNCIL, buildTypedData, refreshApp, resetAll, signInSafe, expect, test } from "./support";

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
  await expect(set.getByTestId("signature-count")).toHaveText("0 signatures · 3 required");

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
  await expect(set.getByTestId("signature-count")).toHaveText("3 signatures · 3 required");
  await expect(set.getByTestId("threshold-met")).toBeVisible();
  // The transaction it makes is in Your signature, simulated in its review.
  await page.getByTestId("your-signature").getByTestId("review-send").click();
  await expect(page.getByRole("dialog").getByTestId("simulation-ok")).toBeVisible();
});

test("an emergency payload pasted as JSON is checked, fills the form and goes on to signing", async ({
  page,
}) => {
  await page.goto("/app/emergency/new");
  await page.getByRole("button", { name: "JSON", exact: true }).click();
  const json = page.getByTestId("payload-json");
  await json.fill('{ "salt": "0x12", "calls": [] ');
  await expect(page.getByTestId("payload-json-error")).toHaveText("Not valid JSON.");
  await expect(page.getByRole("button", { name: "Continue to signing" })).toBeDisabled();
  await json.fill(
    JSON.stringify({
      title: "Pasted",
      salt: `0x${"12".repeat(32)}`,
      calls: [
        {
          target: "0x000000000000000000000000000000000000dEaD",
          value: "1000000000000000000",
          data: "0x",
        },
      ],
    })
  );
  await expect(page.getByTestId("payload-json-error")).toHaveCount(0);
  await page.getByRole("button", { name: "Form", exact: true }).click();
  await expect(page.getByPlaceholder("Value (ETH)")).toHaveValue("1");
  await page.getByRole("button", { name: "Continue to signing" }).click();
  await expect(page).toHaveURL(/\/app\/emergency\/0x[0-9a-f]{64}$/);
  await expect(page.getByTestId("payload-ok")).toContainText("“Pasted”");
  await expect(page.getByTestId("your-signature")).toBeVisible();
});

test("a payload.json dropped on the builder loads like a paste; dropped on an upgrade's page it is checked against the id", async ({
  page,
}) => {
  const drop = async (target: ReturnType<typeof page.getByTestId>, text: string) => {
    const dataTransfer = await page.evaluateHandle((json) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([json], "payload.json", { type: "application/json" }));
      return transfer;
    }, text);
    await target.dispatchEvent("dragenter", { dataTransfer });
    await expect(page.getByTestId("json-drop-over")).toBeVisible();
    await target.dispatchEvent("drop", { dataTransfer });
  };
  const payload = {
    title: "Dropped",
    salt: `0x${"34".repeat(32)}`,
    calls: [{ target: "0x000000000000000000000000000000000000dEaD", value: "0", data: "0x" }],
  };
  await page.goto("/app/emergency/new");
  await drop(page.getByTestId("json-drop"), JSON.stringify(payload));
  await expect(page.getByTestId("payload-json")).toHaveValue(/"Dropped"/);
  await page.getByRole("button", { name: "Continue to signing" }).click();
  await expect(page.getByTestId("payload-ok")).toContainText("“Dropped”");

  // The pending, fully signed id on mainnet: the same file, dropped on its page, is refused.
  await page.goto(
    "/app/emergency/0x4fa238865a64c1ccc992bfc0a4e984d13443e0e87c67feddb3cedc6f20f59f59"
  );
  await drop(page.getByTestId("json-drop"), JSON.stringify(payload));
  await expect(page.getByTestId("payload-error")).toContainText("not to the signed id");
});

test("an emergency payload is built, hashed and checked in the browser", async ({ page }) => {
  await page.goto("/app/emergency/new");
  await page.getByPlaceholder("Target address").fill("0x000000000000000000000000000000000000dEaD");
  // Its calls checked on the RPC: the answer under the button, each call's under it.
  await page.getByTestId("check-calls").click();
  await expect(page.getByTestId("call-check-title")).toHaveText("The call succeeds");
  await expect(page.getByTestId("call-check-row")).toContainText("Call 1 · transfer of nothing");
  await expect(page.getByTestId("call-check-line")).toContainText("Succeeds as an eth_call");
  // Edited after it: said, never shown under the old verdict.
  await page.getByPlaceholder("Calldata (0x…)").fill("0x12345678");
  await expect(page.getByTestId("call-check-title")).toHaveText("Checked before your last edit");
  await expect(page.getByTestId("call-check-line")).toHaveText("Changed since the check");
  await page.getByPlaceholder("Calldata (0x…)").fill("0x");
  await page.getByRole("button", { name: "Continue to signing" }).click();
  await expect(page).toHaveURL(/\/app\/emergency\/0x[0-9a-f]{64}$/);
  await expect(page.getByTestId("payload-ok")).toContainText("The payload hashes to this id");
  await expect(page.getByTestId("set-securityCouncil").getByTestId("signature-count")).toHaveText(
    "0 signatures · 6 required"
  );

  // Its payload is the one just built, kept in this browser and matching: nothing to warn about.
  await expect(page.getByTestId("unchecked-payload")).toHaveCount(0);

  // An id nobody signed yet and no payload here (the first signer's view): warned all the same.
  await page.goto(`/app/emergency/0x${"ab".repeat(32)}`);
  await expect(page.getByTestId("unchecked-payload")).toContainText(
    "A signature covers only its id, not the calls it runs"
  );

  // The pending, fully signed id on mainnet: signed, with no payload here to check it against.
  await page.goto(
    "/app/emergency/0x4fa238865a64c1ccc992bfc0a4e984d13443e0e87c67feddb3cedc6f20f59f59"
  );
  const warning = page.getByTestId("unchecked-payload");
  await expect(warning).toContainText("Check the payload before you sign or execute");
  // Its button goes to the payload box.
  await warning.getByRole("button", { name: "Load the payload" }).click();
  await expect(page.getByLabel("Paste the payload JSON")).toBeFocused();
  // A payload for anything else is refused, and the warning says not to rely on it.
  await page.getByLabel("Paste the payload JSON").fill(
    JSON.stringify({
      salt: `0x${"00".repeat(32)}`,
      calls: [{ target: "0x000000000000000000000000000000000000dEaD", value: "0", data: "0x" }],
    })
  );
  await page.getByTestId("check-payload").click();
  await expect(page.getByTestId("payload-error")).toContainText("not to the signed id");
  await expect(warning).toHaveAttribute("data-kind", "mismatch");
  await expect(warning).toContainText("The payload you loaded does not match this id");
  // The groups start folded on an emergency upgrade: the row says the threshold is met, the
  // unfolded group what accepted it.
  const council = page.getByTestId("set-securityCouncil");
  await expect(council.getByText("Threshold met").first()).toBeVisible();
  await council.getByRole("button", { name: /^Security Council: / }).click();
  await expect(council.getByTestId("threshold-met")).toBeVisible();
});
