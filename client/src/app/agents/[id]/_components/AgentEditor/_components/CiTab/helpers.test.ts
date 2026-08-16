import { describe, it, expect, vi, afterEach } from "vitest";
import { relativeTime, runStatusMeta } from "./helpers";

afterEach(() => vi.useRealTimers());

describe("relativeTime", () => {
  it("returns null for a missing timestamp (caller renders the 'never' copy)", () => {
    expect(relativeTime(null)).toBeNull();
    expect(relativeTime(undefined)).toBeNull();
  });

  it("returns null for an unparsable timestamp", () => {
    expect(relativeTime("not-a-date")).toBeNull();
  });

  it("formats minutes/hours/days ago", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-16T12:00:00.000Z"));

    expect(relativeTime(new Date("2026-08-16T11:59:55.000Z").toISOString())).toBe("now");
    expect(relativeTime(new Date("2026-08-16T11:45:00.000Z").toISOString())).toBe("15m");
    expect(relativeTime(new Date("2026-08-16T09:00:00.000Z").toISOString())).toBe("3h");
    expect(relativeTime(new Date("2026-08-14T12:00:00.000Z").toISOString())).toBe("2d");
  });
});

describe("runStatusMeta", () => {
  it("maps every CiRunStatus to a distinct icon + label key (never colour alone)", () => {
    expect(runStatusMeta("succeeded").labelKey).toBe("runs.status.succeeded");
    expect(runStatusMeta("no_findings").labelKey).toBe("runs.status.noFindings");
    expect(runStatusMeta("failed").labelKey).toBe("runs.status.failed");
    expect(runStatusMeta("running").labelKey).toBe("runs.status.running");

    const icons = [
      runStatusMeta("succeeded").icon,
      runStatusMeta("failed").icon,
      runStatusMeta("running").icon,
    ];
    expect(new Set(icons).size).toBe(3);
  });

  it("falls back to a 'never' meta for a missing/unknown status", () => {
    expect(runStatusMeta(null).labelKey).toBe("ciTab.never");
    expect(runStatusMeta(undefined).labelKey).toBe("ciTab.never");
  });
});
