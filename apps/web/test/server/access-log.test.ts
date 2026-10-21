import { describe, expect, it } from "vitest";

// The access log names each request's path and query, never a signature the viewer supplied:
// `?sig=<memberSafe>:<signature>` is verified on-chain and "stored nowhere" (AGENTS.md), log
// files included.

const { loggedUrl } = await import("@server/middlewares/logger");

const SAFE = "0x34Ea81bA27a0F64B3C0D3B2AAe3ac0D3fbC96Bb9";
const ID = `0x${"77".repeat(32)}`;

describe("the access log's URL", () => {
  it.each([
    [`/app/proposals/${ID}?sig=${SAFE}:0xdeadbeef`, `/app/proposals/${ID}?sig=[redacted]`],
    [
      `/api/upgrades/${ID}?sig=${SAFE}:0xdeadbeef&sig=${SAFE}%3A0xfeed`,
      `/api/upgrades/${ID}?sig=[redacted]&sig=[redacted]`,
    ],
    [
      `/app/freeze/soft-freeze?nonce=3&sig=${SAFE}:0xdeadbeef&validUntil=1800000000`,
      "/app/freeze/soft-freeze?nonce=3&sig=[redacted]&validUntil=1800000000",
    ],
    // However the name is spelled or encoded.
    [`/app/proposals/${ID}?SIG=${SAFE}:0xdeadbeef`, `/app/proposals/${ID}?SIG=[redacted]`],
    [`/app/proposals/${ID}?%73ig=${SAFE}:0xdeadbeef`, `/app/proposals/${ID}?%73ig=[redacted]`],
    [`/app/proposals/${ID}?sig`, `/app/proposals/${ID}?sig=[redacted]`],
  ])("leaves the signature out of %s", (url, logged) => {
    expect(loggedUrl(url)).toBe(logged);
    expect(loggedUrl(url)).not.toMatch(/deadbeef|feed/);
  });

  it.each([
    "/api/status",
    "/api/upgrades?history=all",
    "/app/freeze/soft-freeze?nonce=3&validUntil=1800000000",
    "/app/l2-cancellations/0x1?governor=0x2&signature=keeps",
  ])("keeps %s as it is", (url) => {
    expect(loggedUrl(url)).toBe(url);
  });
});
