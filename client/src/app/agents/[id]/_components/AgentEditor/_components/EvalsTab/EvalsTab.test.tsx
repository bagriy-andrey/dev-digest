import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import type { EvalCase, EvalDashboard, EvalRunRecord } from "@/lib/types";
import evalMessages from "../../../../../../../../messages/en/eval.json";

// ---- Mocks (static top-level + vi.fn().mockReturnValue per test — per
// client/insights.md's TanStack Query mocking guidance). ----
const useAgentEvalDashboardMock = vi.fn();
const useEvalCasesMock = vi.fn();
const useEvalRunsMock = vi.fn();
const useRunAgentEvalsMock = vi.fn();
const useRunEvalCaseMock = vi.fn();
const useDeleteEvalCaseMock = vi.fn();
const useCreateEvalCaseMock = vi.fn();
const useUpdateEvalCaseMock = vi.fn();

vi.mock("@/lib/hooks/evals", () => ({
  useAgentEvalDashboard: (...args: unknown[]) => useAgentEvalDashboardMock(...args),
  useEvalCases: (...args: unknown[]) => useEvalCasesMock(...args),
  useEvalRuns: (...args: unknown[]) => useEvalRunsMock(...args),
  useRunAgentEvals: (...args: unknown[]) => useRunAgentEvalsMock(...args),
  useRunEvalCase: (...args: unknown[]) => useRunEvalCaseMock(...args),
  useDeleteEvalCase: (...args: unknown[]) => useDeleteEvalCaseMock(...args),
  useCreateEvalCase: (...args: unknown[]) => useCreateEvalCaseMock(...args),
  useUpdateEvalCase: (...args: unknown[]) => useUpdateEvalCaseMock(...args),
}));

import { EvalsTab } from "./EvalsTab";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "Flags secrets and injection",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You are a security reviewer.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
};

const DASHBOARD: EvalDashboard = {
  owner_kind: "agent",
  owner_id: "ag1",
  cases_total: 1,
  current: {
    recall: 0.8,
    precision: 0.9,
    citation_accuracy: 1,
    traces_passed: 1,
    traces_total: 1,
    cost_usd: 0.01,
  },
  delta: { recall: 0.1, precision: -0.05, citation_accuracy: 0 },
  trend: [],
  recent_runs: [],
  recent_batches: [],
  alert: null,
};

const PASSING_CASE: EvalCase = {
  id: "case-1",
  owner_kind: "agent",
  owner_id: "ag1",
  name: "Stripe key leak",
  input_diff: "--- a/x\n+++ b/x",
  input_files: null,
  input_meta: null,
  expected_output: [
    {
      kind: "must_find",
      file: "src/config.ts",
      start_line: 10,
      end_line: 12,
      severity: "CRITICAL",
      category: "security",
      title: "leaked key",
    },
  ],
  notes: null,
};

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      <EvalsTab agent={AGENT} />
    </NextIntlClientProvider>,
  );
}

function mockDefaults() {
  useAgentEvalDashboardMock.mockReturnValue({ data: DASHBOARD });
  useEvalCasesMock.mockReturnValue({ data: [], isLoading: false });
  useEvalRunsMock.mockReturnValue({ data: [] });
  useRunAgentEvalsMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
  useRunEvalCaseMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
  useDeleteEvalCaseMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
  useCreateEvalCaseMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
  useUpdateEvalCaseMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
}

describe("EvalsTab", () => {
  it("renders the metric strip from useAgentEvalDashboard", () => {
    mockDefaults();
    useEvalCasesMock.mockReturnValue({ data: [PASSING_CASE], isLoading: false });

    renderTab();

    expect(screen.getByText("80%")).toBeInTheDocument(); // recall
    expect(screen.getByText("90%")).toBeInTheDocument(); // precision
  });

  it("renders an empty state inviting case creation when the agent has zero cases (AC-21)", () => {
    mockDefaults();

    renderTab();

    expect(screen.getByText(evalMessages.evalsTab.emptyCases)).toBeInTheDocument();
    expect(screen.queryByText(/error/i)).not.toBeInTheDocument();
  });

  it("states the case count before confirming 'Run all evals' (edge case 16)", () => {
    mockDefaults();
    useEvalCasesMock.mockReturnValue({ data: [PASSING_CASE, { ...PASSING_CASE, id: "case-2" }], isLoading: false });
    const runAll = vi.fn();
    useRunAgentEvalsMock.mockReturnValue({ mutate: runAll, isPending: false });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    renderTab();
    fireEvent.click(screen.getByText(evalMessages.evalsTab.runAll));

    expect(confirmSpy).toHaveBeenCalledWith("Run all 2 eval cases for this agent?");
    expect(runAll).toHaveBeenCalledWith("ag1");

    confirmSpy.mockRestore();
  });

  it("does not trigger a run when the confirmation is declined", () => {
    mockDefaults();
    useEvalCasesMock.mockReturnValue({ data: [PASSING_CASE], isLoading: false });
    const runAll = vi.fn();
    useRunAgentEvalsMock.mockReturnValue({ mutate: runAll, isPending: false });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    renderTab();
    fireEvent.click(screen.getByText(evalMessages.evalsTab.runAll));

    expect(runAll).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("renders expected/got counts and a failure reason when the last run failed", () => {
    mockDefaults();
    useEvalCasesMock.mockReturnValue({ data: [PASSING_CASE], isLoading: false });
    const failedRun: EvalRunRecord = {
      id: "run-1",
      case_id: "case-1",
      case_name: "Stripe key leak",
      ran_at: "2026-07-20T00:00:00.000Z",
      actual_output: { findings: [], counts: { must_find: 1, matched: 0, actual: 0, noise: 0, dropped: 0 }, model: null, error: "provider timed out" },
      pass: false,
      recall: 0,
      precision: null,
      citation_accuracy: null,
      duration_ms: 1200,
      cost_usd: 0.002,
      batch_id: "batch-1",
      agent_version: 1,
    };
    useEvalRunsMock.mockReturnValue({ data: [failedRun] });

    renderTab();

    expect(screen.getByText("Expected 1 · Got 0")).toBeInTheDocument();
    expect(screen.getByText("Failure: provider timed out")).toBeInTheDocument();
  });

  it("shows 'never run' for a case with no run history", () => {
    mockDefaults();
    useEvalCasesMock.mockReturnValue({ data: [PASSING_CASE], isLoading: false });

    renderTab();

    expect(screen.getByText(evalMessages.evalsTab.neverRun)).toBeInTheDocument();
  });
});
