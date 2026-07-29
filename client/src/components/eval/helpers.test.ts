import { describe, expect, it } from "vitest";
import { formatMetric, largestMovement, metricNa, signedDelta } from "./helpers";
import type { EvalBatchSummary } from "@/lib/types";

describe("formatMetric", () => {
  it("renders a percentage when na is false", () => {
    expect(formatMetric(0.92, false)).toBe("92%");
  });

  it("renders the not-applicable marker when na is true, regardless of value", () => {
    expect(formatMetric(1, true)).toBe("—");
    expect(formatMetric(0, true)).toBe("—");
  });

  it("rounds to the nearest whole percentage point", () => {
    expect(formatMetric(0.666, false)).toBe("67%");
  });
});

describe("signedDelta", () => {
  it("renders a positive delta with an explicit '+' sign", () => {
    expect(signedDelta(0.04)).toBe("+4pt");
  });

  it("renders a negative delta with a true minus sign", () => {
    expect(signedDelta(-0.02)).toBe("−2pt");
  });

  it("renders zero without a sign", () => {
    expect(signedDelta(0)).toBe("0pt");
  });
});

function summary(overrides: Partial<EvalBatchSummary>): EvalBatchSummary {
  return {
    batch_id: "b1",
    agent_id: "a1",
    agent_name: "Agent",
    agent_version: 1,
    ran_at: "2026-07-29T00:00:00.000Z",
    cases_total: 10,
    cases_passed: 9,
    recall: 0.9,
    precision: 0.9,
    citation_accuracy: 0.9,
    recall_na: false,
    precision_na: false,
    citation_accuracy_na: false,
    cost_usd: 0.01,
    duration_ms: 1000,
    status: "complete",
    ...overrides,
  };
}

describe("metricNa", () => {
  it("reads the recall_na flag for 'recall'", () => {
    expect(metricNa(summary({ recall_na: true }), "recall")).toBe(true);
    expect(metricNa(summary({ recall_na: false }), "recall")).toBe(false);
  });

  it("reads the precision_na flag for 'precision'", () => {
    expect(metricNa(summary({ precision_na: true }), "precision")).toBe(true);
  });

  it("reads the citation_accuracy_na flag for 'citation_accuracy'", () => {
    expect(metricNa(summary({ citation_accuracy_na: true }), "citation_accuracy")).toBe(true);
  });
});

const metrics = (recall: number, precision: number, citation_accuracy: number) => ({
  recall,
  precision,
  citation_accuracy,
});

describe("largestMovement", () => {
  it("returns null when previous is null", () => {
    expect(largestMovement(metrics(0.9, 0.9, 0.9), null)).toBeNull();
  });

  it("returns null when nothing moved", () => {
    const m = metrics(0.9, 0.8, 0.7);
    expect(largestMovement(m, { ...m })).toBeNull();
  });

  it("picks the single largest absolute movement and its direction (up)", () => {
    const current = metrics(0.9, 0.85, 0.7);
    const previous = metrics(0.8, 0.84, 0.69);
    // recall: +0.10, precision: +0.01, citation: +0.01 -> recall wins
    const result = largestMovement(current, previous);
    expect(result?.metric).toBe("recall");
    expect(result?.direction).toBe("up");
    expect(result?.delta).toBeCloseTo(0.1);
  });

  it("picks the direction 'down' when the largest movement is negative", () => {
    const current = metrics(0.9, 0.5, 0.9);
    const previous = metrics(0.89, 0.8, 0.89);
    const result = largestMovement(current, previous);
    expect(result?.metric).toBe("precision");
    expect(result?.direction).toBe("down");
    expect(result?.delta).toBeCloseTo(-0.3);
  });

  it("is a pure function: identical inputs produce an identical result", () => {
    const current = metrics(0.9, 0.5, 0.9);
    const previous = metrics(0.89, 0.8, 0.89);
    const first = largestMovement(current, previous);
    const second = largestMovement(current, previous);
    expect(first).toEqual(second);
  });
});
