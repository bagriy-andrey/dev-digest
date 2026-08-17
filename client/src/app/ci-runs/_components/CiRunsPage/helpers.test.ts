import { describe, it, expect } from "vitest";
import { formatRunCost, formatRunDuration, runStatusMeta } from "./helpers";

describe("formatRunCost", () => {
  it("renders the unknown marker for a null cost, never $0.00 (AC-41)", () => {
    expect(formatRunCost(null, "unknown")).toBe("unknown");
    expect(formatRunCost(undefined, "unknown")).toBe("unknown");
  });

  it("formats a real cost", () => {
    expect(formatRunCost(0.012, "unknown")).toBe("$0.012");
    expect(formatRunCost(2.5, "unknown")).toBe("$2.50");
  });
});

describe("formatRunDuration", () => {
  it("renders the unknown marker for a null duration, never 0s (AC-41)", () => {
    expect(formatRunDuration(null, "unknown")).toBe("unknown");
    expect(formatRunDuration(undefined, "unknown")).toBe("unknown");
  });

  it("formats seconds and minutes", () => {
    expect(formatRunDuration(12.3, "unknown")).toBe("12.3s");
    expect(formatRunDuration(90, "unknown")).toBe("1m 30s");
  });
});

describe("runStatusMeta", () => {
  it("maps every CiRunStatus to a distinct icon + label key", () => {
    expect(runStatusMeta("succeeded").labelKey).toBe("runs.status.succeeded");
    expect(runStatusMeta("no_findings").labelKey).toBe("runs.status.noFindings");
    expect(runStatusMeta("failed").labelKey).toBe("runs.status.failed");
    expect(runStatusMeta("running").labelKey).toBe("runs.status.running");
  });

  it("falls back to an unknown reading for a missing/unrecognised status", () => {
    expect(runStatusMeta(null).labelKey).toBe("runs.unknown");
    expect(runStatusMeta(undefined).labelKey).toBe("runs.unknown");
    expect(runStatusMeta("something-new").labelKey).toBe("runs.unknown");
  });
});
