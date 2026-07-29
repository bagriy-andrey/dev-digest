import { describe, it, expect } from "vitest";
import { sortAgentsByName, totalCaseCount, batchLineParts } from "./helpers";
import type { EvalAgentRow } from "@/lib/types";

function agent(overrides: Partial<EvalAgentRow>): EvalAgentRow {
  return {
    agent_id: "a1",
    agent_name: "A",
    provider: "openai",
    model: "gpt-4.1",
    enabled: true,
    cases_total: 0,
    last_batch: null,
    recall_trend: [],
    ...overrides,
  };
}

describe("sortAgentsByName", () => {
  it("sorts agents alphabetically regardless of input order (refetch stability)", () => {
    const agents = [agent({ agent_name: "Zeta" }), agent({ agent_name: "Alpha" }), agent({ agent_name: "Mid" })];
    expect(sortAgentsByName(agents).map((a) => a.agent_name)).toEqual(["Alpha", "Mid", "Zeta"]);
  });

  it("does not mutate the input array", () => {
    const agents = [agent({ agent_name: "Zeta" }), agent({ agent_name: "Alpha" })];
    const copy = [...agents];
    sortAgentsByName(agents);
    expect(agents).toEqual(copy);
  });
});

describe("totalCaseCount", () => {
  it("sums cases_total across every agent row", () => {
    const agents = [agent({ cases_total: 8 }), agent({ cases_total: 6 }), agent({ cases_total: 0 })];
    expect(totalCaseCount(agents)).toBe(14);
  });

  it("returns 0 for an empty agent list", () => {
    expect(totalCaseCount([])).toBe(0);
  });
});

describe("batchLineParts", () => {
  it("formats a recorded agent version, date and pass count", () => {
    const parts = batchLineParts({
      agent_version: 3,
      ran_at: "2026-07-20T10:00:00.000Z",
      cases_passed: 6,
      cases_total: 8,
    });
    expect(parts.version).toBe("3");
    expect(parts.passed).toBe(6);
    expect(parts.total).toBe(8);
    expect(parts.date).toBe(new Date("2026-07-20T10:00:00.000Z").toLocaleDateString());
  });

  it("falls back to an em dash when agent_version was never recorded", () => {
    const parts = batchLineParts({
      agent_version: null,
      ran_at: "2026-07-20T10:00:00.000Z",
      cases_passed: 1,
      cases_total: 1,
    });
    expect(parts.version).toBe("—");
  });
});
