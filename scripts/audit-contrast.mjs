// Read-only browser audit. Run after starting the app; uses the e2e package's Playwright.
// Audits computed styles, ancestor backgrounds, placeholders, and text-bearing opacity.
// Images/gradients are flagged for visual review rather than assigned invented ratios.
import { mkdir, writeFile } from "node:fs/promises";
import { webkit } from "../packages/e2e/node_modules/@playwright/test/index.mjs";

const baseURL = process.env.CONTRAST_URL ?? "http://127.0.0.1:3000";
const output = process.env.CONTRAST_OUTPUT ?? ".cache/local/contrast-after.json";
const status = await fetch(`${baseURL}/api/status`).then((r) => r.json());
if (
  !status.ok ||
  status.governance.warnings.length ||
  status.governance.network.overrides.length ||
  status.logHistory.status !== "ok"
) {
  throw new Error("Governance status needs review; stopped the read-only audit.");
}
const upgrade = "0x77d5461c37515d627820ab6573efe63fb0b253cf83308dbb368b859e9835eaaa";
const emergency = "0xb1660380be18f4cf30cb1a253d3e91da3e584ca7ae82d7d6fd9675a722d6da5e";
const routes = [
  "/",
  "/settings",
  "/app/proposals",
  `/app/proposals/${upgrade}`,
  "/app/proposals/new",
  "/app/emergency",
  `/app/emergency/${emergency}`,
  "/app/emergency/new",
  "/app/freeze",
  `/app/freeze/soft-freeze?nonce=${status.governance.securityCouncil.nonces.softFreeze}&validUntil=${Number(status.governance.latestBlock.timestamp) + 86400}`,
  "/app/l2-cancellations",
  "/app/l2-cancellations/new",
  "/app/l2-cancellations/0?governor=0x76705327e682F2d96943280D99464Ab61219e34f&l2GasLimit=1000000&l2GasPerPubdataByteLimit=800&refundRecipient=0x0000000000000000000000000000000000000000&txMintValue=0&nonce=0",
  "/app/transactions/0x1defa4f7f06a4c8a5066ea56f2a27b00a2beeb016cec336692e39460c3f55e11",
  "/contrast-not-found",
];
const profiles = process.env.CONTRAST_QUICK
  ? [{ width: 1440, height: 1000, colorScheme: "light" }]
  : [
      { width: 1440, height: 1000, colorScheme: "light" },
      { width: 390, height: 844, colorScheme: "light" },
      { width: 1440, height: 1000, colorScheme: "dark" },
      { width: 390, height: 844, colorScheme: "dark" },
    ];

function inspectContrast(selector) {
  const scope = typeof selector === "string" ? document.querySelector(selector) : document.body;
  const parse = (value) => {
    const numbers = value.match(/[\d.]+/g)?.map(Number);
    if (!numbers || numbers.length < 3) throw new Error(`Unsupported color: ${value}`);
    return [numbers[0], numbers[1], numbers[2], numbers[3] ?? 1];
  };
  const blend = (front, back) => {
    const alpha = front[3] + back[3] * (1 - front[3]);
    return front
      .slice(0, 3)
      .map((c, i) => (alpha ? (c * front[3] + back[i] * back[3] * (1 - front[3])) / alpha : 0))
      .concat(alpha);
  };
  const hex = (c) =>
    `#${c
      .slice(0, 3)
      .map((v) => Math.round(v).toString(16).padStart(2, "0"))
      .join("")}`;
  const luminance = (c) =>
    c.slice(0, 3).reduce((sum, v, i) => {
      const s = v / 255;
      return (
        sum +
        (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][i]
      );
    }, 0);
  const samples = [];
  const inspect = (element, text, pseudo) => {
    const style = getComputedStyle(element, pseudo);
    if (!element.getClientRects().length || style.visibility !== "visible") return;
    const chain = [];
    for (let e = element; e; e = e.parentElement) chain.unshift(e);
    let background = [0, 0, 0, 0];
    let effective = parse(style.color);
    if (pseudo) effective[3] *= Number(style.opacity);
    let image = false;
    let opacity = 1;
    for (const e of chain.reverse()) {
      const s = getComputedStyle(e);
      const bg = parse(s.backgroundColor);
      if (background[3] < 1 && s.backgroundImage !== "none") image = true;
      effective = blend(effective, bg);
      background = blend(background, bg);
      effective[3] *= Number(s.opacity);
      background[3] *= Number(s.opacity);
      opacity *= Number(s.opacity);
    }
    background = blend(background, [255, 255, 255, 1]);
    effective = blend(effective, [255, 255, 255, 1]);
    const ls = [luminance(effective), luminance(background)].sort((a, b) => a - b);
    const ratio = (ls[1] + 0.05) / (ls[0] + 0.05);
    const large =
      Number.parseFloat(style.fontSize) >= 24 ||
      (Number.parseFloat(style.fontSize) >= 18.6667 && Number(style.fontWeight) >= 700);
    samples.push({
      text: text.trim().slice(0, 110),
      tag: element.tagName,
      classes: element.className,
      placeholder: !!pseudo,
      foreground: hex(effective),
      background: hex(background),
      ratio,
      minimum: large ? 3 : 4.5,
      opacity,
      image,
      pass: !image && ratio >= (large ? 3 : 4.5),
    });
  };
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const element = node.parentElement;
    if (
      !node.textContent.trim() ||
      !element ||
      element.closest("script,style,svg,[aria-hidden='true'],.sr-only")
    )
      continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    if (![...range.getClientRects()].some((r) => r.width && r.height)) continue;
    inspect(element, node.textContent);
  }
  for (const input of scope.querySelectorAll("input,textarea")) {
    if (input.value) inspect(input, input.value);
    else if (input.placeholder) inspect(input, input.placeholder, "::placeholder");
  }
  return samples;
}

const browser = await webkit.launch({ headless: true });
const results = [];
try {
  for (const profile of profiles) {
    const context = await browser.newContext({
      viewport: profile,
      colorScheme: profile.colorScheme,
    });
    const page = await context.newPage();
    for (const route of routes) {
      if (process.env.CONTRAST_MATCH && !new RegExp(process.env.CONTRAST_MATCH).test(route))
        continue;
      const errors = [];
      const onError = (error) => errors.push(error.message);
      page.on("pageerror", onError);
      await page.goto(`${baseURL}${route}`, { waitUntil: "networkidle", timeout: 90000 });
      if ((await page.locator("body").innerText()).includes("The page could not load"))
        throw new Error(`Router fallback on ${route}`);
      if (route.includes(`/app/proposals/${upgrade}`)) {
        // Reveal verification hashes and raw calldata without invoking signing or sending.
        for (const button of await page.locator("button[aria-expanded]").all()) {
          if (
            (await button.isVisible()) &&
            (await button.isEnabled()) &&
            (await button.getAttribute("aria-expanded")) === "false"
          )
            await button.click({ timeout: 5000 });
        }
      }
      const record = async (state = "default", selector = "body") => {
        const samples = await page.evaluate(inspectContrast, selector);
        results.push({
          route,
          profile,
          state,
          errors: [...errors],
          samples,
          failures: samples.filter((s) => !s.pass),
        });
        console.log(
          `${profile.width}/${profile.colorScheme} ${route.split("?")[0]} (${state}): ${samples.length} text samples, ${samples.filter((s) => !s.pass).length} failures`
        );
      };
      await record();
      if (route === "/") {
        await page.getByRole("button", { name: "Open", exact: true }).hover();
        await page.waitForTimeout(200);
        await record("primary-hover");
        await page.getByRole("button", { name: "Open", exact: true }).focus();
        await record("primary-focus");
      }
      if (
        !process.env.CONTRAST_QUICK &&
        profile.colorScheme === "light" &&
        ["/", "/settings", `/app/proposals/${upgrade}`].includes(route)
      ) {
        await mkdir(".cache/local/contrast", { recursive: true });
        const name = route === "/" ? "home" : route === "/settings" ? "settings" : "upgrade";
        await page.screenshot({
          path: `.cache/local/contrast/${name}-${profile.width}.png`,
          fullPage: true,
        });
      }
      if (route === "/app/freeze") {
        await page.getByTestId("new-freeze").hover();
        await page.waitForTimeout(200);
        await record("secondary-hover");
        await page.getByTestId("new-freeze").click();
        await page.getByRole("dialog").waitFor();
        await page.waitForTimeout(250);
        await record("freeze-dialog", "[role='dialog']");
        await page.getByRole("button", { name: "Close", exact: true }).click();
      }
      if (
        route.includes("/app/freeze/soft-freeze") &&
        (await page.getByTestId("connect-wallet").count())
      ) {
        await page.getByTestId("connect-wallet").click();
        await page.getByRole("dialog").waitFor();
        await page.waitForTimeout(250);
        await record("wallet-dialog", "[role='dialog']");
        await page.keyboard.press("Escape");
      }
      page.off("pageerror", onError);
    }
    await context.close();
  }
} finally {
  await browser.close();
  await mkdir(".cache/local", { recursive: true });
  await writeFile(output, JSON.stringify(results, null, 2));
}
const failures = results.flatMap((r) => r.failures);
console.log(
  `${results.length} page/profile checks; ${failures.length} contrast failures. Report: ${output}`
);
if (failures.length) process.exitCode = 1;
