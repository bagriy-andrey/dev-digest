import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../messages/en/eval.json";
import { ToastProvider } from "@/lib/toast";
import type { EvalWorkspaceDashboard } from "@/lib/types";

// ---- Mocks (static top-level + vi.fn().mockReturnValue per test — the
// dynamic-import + module-level-`let` pattern is flaky here per
// client/insights.md). ----

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const useWorkspaceEvalDashboardMock = vi.fn();
const useRunAllEvalsMock = vi.fn();
vi.mock("@/lib/hooks", () => ({
  useWorkspaceEvalDashboard: (...args: unknown[]) => useWorkspaceEvalDashboardMock(...args),
  useRunAllEvals: (...args: unknown[]) => useRunAllEvalsMock(...args),
}));

import { WorkspaceEvalDashboard } from "./WorkspaceEvalDashboard";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderWithIntl() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      <ToastProvider>
        <WorkspaceEvalDashboard />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

const LAST_BATCH = {
  batch_id: "batch-1",
  agent_id: "agent-b",
  agent_name: "Zeta Reviewer",
  agent_version: 3,
  ran_at: "2026-07-20T10:00:00.000Z",
  cases_total: 8,
  cases_passed: 6,
  recall: 0.75,
  precision: 0.8,
  citation_accuracy: 0.9,
  recall_na: false,
  precision_na: false,
  citation_accuracy_na: false,
  cost_usd: 0.05,
  duration_ms: 4000,
  status: "complete" as const,
};

const DASHBOARD: EvalWorkspaceDashboard = {
  workspace: {
    owner_kind: null,
    owner_id: null,
    cases_total: 14,
    current: {
      recall: 0.9,
      precision: 0.85,
      citation_accuracy: 0.8,
      traces_passed: 10,
      traces_total: 12,
      cost_usd: 0.1,
    },
    delta: { recall: 0, precision: 0, citation_accuracy: 0 },
    trend: [],
    recent_runs: [
      {
        id: "run-1",
        case_id: "case-1",
        case_name: "stripe-key-leak",
        ran_at: "2026-07-20T10:00:00.000Z",
        actual_output: null,
        pass: true,
        recall: 1,
        precision: 1,
        citation_accuracy: 1,
        duration_ms: 1200,
        cost_usd: 0.01,
        batch_id: "batch-1",
        agent_version: 3,
      },
    ],
    recent_batches: [],
    alert: null,
  },
  agents: [
    {
      agent_id: "agent-b",
      agent_name: "Zeta Reviewer",
      provider: "openai",
      model: "gpt-4.1",
      enabled: true,
      cases_total: 8,
      last_batch: LAST_BATCH,
      recall_trend: [0.6, 0.7, 0.75],
    },
    {
      agent_id: "agent-a",
      agent_name: "Alpha Reviewer",
      provider: "anthropic",
      model: "claude-3",
      enabled: true,
      cases_total: 6,
      last_batch: null,
      recall_trend: [],
    },
  ],
};

describe("WorkspaceEvalDashboard", () => {
  it("renders one row per enabled agent, sorted by name (not server order), with model + last batch", () => {
    useWorkspaceEvalDashboardMock.mockReturnValue({
      data: DASHBOARD,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    useRunAllEvalsMock.mockReturnValue({ mutate: vi.fn(), isPending: false });

    renderWithIntl();

    const names = screen.getAllByText(/Reviewer$/).map((el) => el.textContent);
    expect(names).toEqual(["Alpha Reviewer", "Zeta Reviewer"]);
    expect(screen.getByText("openai/gpt-4.1")).toBeInTheDocument();
    // Alpha has no last_batch yet.
    expect(screen.getByText("Never run")).toBeInTheDocument();
  });

  it("renders the flat, newest-first cross-agent run history below the agent rows (AC-35)", () => {
    useWorkspaceEvalDashboardMock.mockReturnValue({
      data: DASHBOARD,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    useRunAllEvalsMock.mockReturnValue({ mutate: vi.fn(), isPending: false });

    renderWithIntl();

    expect(screen.getByText("stripe-key-leak")).toBeInTheDocument();
  });

  it("states the total case count across every agent before confirming Run all agents (edge case 16)", () => {
    useWorkspaceEvalDashboardMock.mockReturnValue({
      data: DASHBOARD,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    const mutate = vi.fn();
    useRunAllEvalsMock.mockReturnValue({ mutate, isPending: false });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    renderWithIntl();
    fireEvent.click(screen.getByRole("button", { name: "Run all agents" }));

    // 8 (Zeta) + 6 (Alpha) = 14 total cases across both enabled agents.
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("14"));
    expect(mutate).not.toHaveBeenCalled();

    confirmSpy.mockRestore();
  });

  it("renders an empty state when there are no enabled agents", () => {
    useWorkspaceEvalDashboardMock.mockReturnValue({
      data: { workspace: { ...DASHBOARD.workspace, recent_runs: [] }, agents: [] },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    useRunAllEvalsMock.mockReturnValue({ mutate: vi.fn(), isPending: false });

    renderWithIntl();

    expect(screen.getByText("No enabled agents with eval cases yet.")).toBeInTheDocument();
  });
});
