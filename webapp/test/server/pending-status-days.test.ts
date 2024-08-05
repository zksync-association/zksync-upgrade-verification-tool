import { calculateStatusPendingDays, daysInSeconds } from "@/.server/service/proposal-times";
import { PROPOSAL_STATES } from "@/utils/proposal-states";
import { describe, expect, it } from "vitest";

describe("calculateStatusPendingDays", () => {
  const nowInSeconds = Math.ceil(new Date().valueOf() / 1000);
  it("returns null for DONE state", () => {
    const creationTime = nowInSeconds;
    const now = creationTime + daysInSeconds(40);

    const res = calculateStatusPendingDays(PROPOSAL_STATES.Done, creationTime, false, now);

    expect(res).toBe(null);
  });

  it("returns null for EXPIRED state", () => {
    const creationTime = nowInSeconds;
    const now = creationTime + daysInSeconds(40);

    const res = calculateStatusPendingDays(PROPOSAL_STATES.Expired, creationTime, false, now);

    expect(res).toBe(null);
  });

  it("returns null for Ready state", () => {
    const creationTime = nowInSeconds;
    const now = creationTime + daysInSeconds(40);

    const res = calculateStatusPendingDays(PROPOSAL_STATES.Ready, creationTime, false, now);

    expect(res).toBe(null);
  });

  it("returns null for None state", () => {
    const creationTime = nowInSeconds;
    const now = creationTime + daysInSeconds(40);

    const res = calculateStatusPendingDays(PROPOSAL_STATES.None, creationTime, false, now);

    expect(res).toBe(null);
  });

  describe("LegalVetoPeriod", () => {
    it("returns 3 as totalDays when was not extended", () => {
      const creationTime = nowInSeconds;
      const now = creationTime + 1;

      const res = calculateStatusPendingDays(
        PROPOSAL_STATES.LegalVetoPeriod,
        creationTime,
        false,
        now
      );

      expect(res?.totalDays).toBe(3);
    });

    it("returns 7 as totalDays when was not extended", () => {
      const creationTime = nowInSeconds;
      const now = creationTime + 1;

      const res = calculateStatusPendingDays(
        PROPOSAL_STATES.LegalVetoPeriod,
        creationTime,
        true,
        now
      );

      expect(res?.totalDays).toBe(7);
    });

    it("returns 1 currentDay when just created", () => {
      const creationTime = nowInSeconds;
      const now = creationTime + 1;

      const res = calculateStatusPendingDays(
        PROPOSAL_STATES.LegalVetoPeriod,
        creationTime,
        true,
        now
      );

      expect(res?.currentDay).toBe(1);
    });

    it("returns 2 currentDay a day after creation", () => {
      const creationTime = nowInSeconds;
      const now = creationTime + daysInSeconds(1) + 1;

      const res = calculateStatusPendingDays(
        PROPOSAL_STATES.LegalVetoPeriod,
        creationTime,
        true,
        now
      );

      expect(res?.currentDay).toBe(2);
    });
  });

  describe("Waiting", () => {
    it("returns 30 as totalDays", () => {
      const creationTime = nowInSeconds;
      const now = creationTime + daysInSeconds(1) + 1;

      const res = calculateStatusPendingDays(PROPOSAL_STATES.Waiting, creationTime, false, now);

      expect(res?.totalDays).toBe(30);
    });

    it("returns currentDay as amount of days since end of veto period (when not extended)", () => {
      const creationTime = nowInSeconds;
      const now = creationTime + daysInSeconds(3) + daysInSeconds(7) - 1;

      const res = calculateStatusPendingDays(PROPOSAL_STATES.Waiting, creationTime, false, now);

      expect(res?.currentDay).toBe(7);
    });

    it("returns currentDay as amount of days since end of veto period (when extended)", () => {
      const creationTime = nowInSeconds;
      const now = creationTime + daysInSeconds(7) + daysInSeconds(10) - 1;

      const res = calculateStatusPendingDays(PROPOSAL_STATES.Waiting, creationTime, true, now);

      expect(res?.currentDay).toBe(10);
    });
  });

  describe("state ExecutionPending", () => {
    it("returns 1 in currentDay and 1 in totalDays", () => {
      const creationTime = nowInSeconds;
      const now = creationTime + daysInSeconds(30);

      const res = calculateStatusPendingDays(
        PROPOSAL_STATES.ExecutionPending,
        creationTime,
        true,
        now
      );

      expect(res?.currentDay).toBe(1);
      expect(res?.totalDays).toBe(1);
    });
  });
});

describe("daysInSeconds", () => {
  it("returns right values", () => {
    expect(daysInSeconds(1)).toEqual(86400);
    expect(daysInSeconds(0)).toEqual(0);
    expect(daysInSeconds(10)).toEqual(864000);
    expect(daysInSeconds(-1)).toEqual(-86400);
  });
});
