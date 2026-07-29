import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../messages/en/eval.json";
import type { Agent } from "@devdigest/shared";
import { ToastProvider } from "@/lib/toast";
import type { EvalDashboard } from "@/lib/types";

// ---- Mocks (static top-level + vi.fn().mockReturnValue per test — see
// client/insights.md on why not a module-level mutable `let` + dynamic
// `import()`). ----

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const useAgentMock = vi.fn();
const useAgentEvalDashboardMock = vi.fn();
const useRunAgentEvalsMock = vi.fn();
const useEvalCompareMock = vi.fn();
const usePromoteAgentVersionMock = vi.fn();
vi.mock("@/lib/hooks", () => ({
  useAgent: (...args: unknown[]) => useAgentMock(...args),
  useAgentEvalDashboard: (...args: unknown[]) => useAgentEvalDashboardMock(...args),
  useRunAgentEvals: (...args: unknown[]) => useRunAgentEvalsMock(...args),
  useEvalCompare: (...args: unknown[]) => useEvalCompareMock(...args),
  usePromoteAgentVersion: (...args: unknown[]) => usePromoteAgentVersionMock(...args),
}));

import { AgentEvalDashboard } from "./AgentEvalDashboard";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderWithIntl() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      <ToastProvider>
        <AgentEvalDashboard agentId="agent-1" />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

const AGENT: Agent = {
  id: "agent-1",
  name: "Security Reviewer",
  description: "",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You are a security reviewer.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 3,
};

function batch(overrides: Partial<EvalDashboard["recent_batches"][number]>) {
  return {
    batch_id: "batch-1",
    agent_id: "agent-1",
    agent_name: "Security Reviewer",
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
    ...overrides,
  };
}

function dashboard(overrides: Partial<EvalDashboard>): EvalDashboard {
  return {
    owner_kind: "agent",
    owner_id: "agent-1",
    cases_total: 8,
    current: {
      recall: 0.75,
      precision: 0.8,
      citation_accuracy: 0.9,
      traces_passed: 6,
      traces_total: 8,
      cost_usd: 0.05,
    },
    delta: { recall: 0.1, precision: 0, citation_accuracy: 0 },
    trend: [
      { ran_at: "2026-07-19T10:00:00.000Z", recall: 0.65, precision: 0.8, citation_accuracy: 0.9, pass_rate: 0.6, cost_usd: 0.04 },
      { ran_at: "2026-07-20T10:00:00.000Z", recall: 0.75, precision: 0.8, citation_accuracy: 0.9, pass_rate: 0.75, cost_usd: 0.05 },
    ],
    recent_runs: [],
    recent_batches: [batch({}), batch({ batch_id: "batch-0", agent_version: 2, recall: 0.65 })],
    alert: null,
    ...overrides,
  };
}

describe("AgentEvalDashboard", () => {
  it("renders current metrics + deltas + pass/total + batch history (AC-33)", () => {
    useAgentMock.mockReturnValue({ data: AGENT });
    useAgentEvalDashboardMock.mockReturnValue({
      data: dashboard({}),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    useRunAgentEvalsMock.mockReturnValue({ mutate: vi.fn(), isPending: false });

    renderWithIntl();

    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getAllByText("80%").length).toBeGreaterThan(0); // precision
    expect(screen.getByText("6/8 pass")).toBeInTheDocument();
    // Batch history: two rows, v3 and v2.
    expect(screen.getByText("v3")).toBeInTheDocument();
    expect(screen.getByText("v2")).toBeInTheDocument();
  });

  it("renders the one-line largest-movement summary (AC-34)", () => {
    useAgentMock.mockReturnValue({ data: AGENT });
    // current.recall (0.75) vs previous batch's recall (0.65) -> +10pt, the
    // largest (only) movement.
    useAgentEvalDashboardMock.mockReturnValue({
      data: dashboard({}),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    useRunAgentEvalsMock.mockReturnValue({ mutate: vi.fn(), isPending: false });

    renderWithIntl();

    expect(screen.getByText("Recall is up 10pt since the previous batch.")).toBeInTheDocument();
  });

  it("omits the movement summary when there is no previous batch to compare against", () => {
    useAgentMock.mockReturnValue({ data: AGENT });
    useAgentEvalDashboardMock.mockReturnValue({
      data: dashboard({ recent_batches: [batch({})] }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    useRunAgentEvalsMock.mockReturnValue({ mutate: vi.fn(), isPending: false });

    renderWithIntl();

    expect(screen.queryByText(/since the previous batch/)).not.toBeInTheDocument();
  });

  it("AC-27: selecting two batches enables Compare; a third selection is prevented", () => {
    useAgentMock.mockReturnValue({ data: AGENT });
    useAgentEvalDashboardMock.mockReturnValue({
      data: dashboard({
        recent_batches: [batch({ batch_id: "b1" }), batch({ batch_id: "b2" }), batch({ batch_id: "b3" })],
      }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    useRunAgentEvalsMock.mockReturnValue({ mutate: vi.fn(), isPending: false });

    renderWithIntl();

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(3);
    const compareButton = screen.getByRole("button", { name: "Compare" });
    expect(compareButton).toBeDisabled();

    fireEvent.click(checkboxes[0]!);
    fireEvent.click(checkboxes[1]!);
    expect(checkboxes[0]).toHaveAttribute("aria-checked", "true");
    expect(checkboxes[1]).toHaveAttribute("aria-checked", "true");
    expect(compareButton).toBeEnabled();

    // A third selection is prevented outright (AC-27), not merely discouraged.
    fireEvent.click(checkboxes[2]!);
    expect(checkboxes[2]).toHaveAttribute("aria-checked", "false");
    expect(compareButton).toBeEnabled();
  });

  it("AC-27: exposes the disabled Compare reason to assistive technology, not just visually", () => {
    useAgentMock.mockReturnValue({ data: AGENT });
    useAgentEvalDashboardMock.mockReturnValue({
      data: dashboard({ recent_batches: [batch({ batch_id: "b1" }), batch({ batch_id: "b2" })] }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    useRunAgentEvalsMock.mockReturnValue({ mutate: vi.fn(), isPending: false });

    renderWithIntl();

    const compareButton = screen.getByRole("button", { name: "Compare" });
    expect(compareButton).toBeDisabled();
    const describedById = compareButton.getAttribute("aria-describedby");
    expect(describedById).toBeTruthy();
    expect(document.getElementById(describedById!)).toHaveTextContent("Select two batches to compare.");
    expect(compareButton).toHaveAttribute("title", "Select two batches to compare.");
  });
});
