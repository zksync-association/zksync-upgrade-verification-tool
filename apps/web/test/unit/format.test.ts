import { formatDay, formatTime } from "@/utils/format";

it("keeps UTC date punctuation identical for SSR and Safari hydration", () => {
  expect(formatTime("2026-09-24T22:49:00Z")).toBe("Sep 24, 2026, 22:49 UTC");
  expect(formatTime(Date.parse("2026-09-24T22:49:00Z") / 1000)).toBe("Sep 24, 2026, 22:49 UTC");
  expect(formatDay("2026-09-24T22:49:00Z")).toBe("Sep 24, 2026");
});

it("renders midnight as 00:00 UTC regardless of browser hour cycle or local timezone", () => {
  expect(formatTime("2026-10-06T02:00:00+02:00")).toBe("Oct 6, 2026, 00:00 UTC");
  expect(formatDay("2026-10-06T00:30:00+02:00")).toBe("Oct 5, 2026");
});
