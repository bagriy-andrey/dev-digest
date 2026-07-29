import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../messages/en/eval.json";
import { ToastProvider } from "@/lib/toast";
import type { EvalCompare } from "@/lib/types";

// ---- Mocks (static top-level + vi.fn().mockReturnValue per test — see
// client/insights.md on why not a module-level mutable `let` + dynamic
// `import()`). ----

const useEvalCompareMock = vi.fn();
const usePromoteAgentVersionMock = vi.fn();
vi.mock("@/lib/hooks", () => ({
  useEvalCompare: (...args: unknown[]) => useEvalCompareMock(...args),
  usePromoteAgentVersion: (...args: unknown[]) => usePromoteAgentVersionMock(...args),
}));

import { CompareModal } from "./CompareModal";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderWithIntl(onClose = vi.fn()) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      <ToastProvider>
        <CompareModal agentId="agent-1" batchA="batch-a" batchB="batch-b" onClose={onClose} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

function batchSummary(overrides: Partial<EvalCompare["a"]>): EvalCompare["a"] {
  return {
    batch_id: "batch-a",
    agent_id: "agent-1",
    agent_name: "Security Reviewer",
    agent_version: 2,
    ran_at: "2026-07-19T10:00:00.000Z",
    cases_total: 8,
    cases_passed: 5,
    recall: 0.65,
    precision: 0.8,
    citation_accuracy: 0.9,
    recall_na: false,
    precision_na: false,
    citation_accuracy_na: false,
    cost_usd: 0.04,
    duration_ms: 4000,
    status: "complete",
    ...overrides,
  };
}

function compareData(overrides: Partial<EvalCompare>): EvalCompare {
  return {
    agent_id: "agent-1",
    a: batchSummary({}),
    b: batchSummary({ batch_id: "batch-b", agent_version: 3, recall: 0.75, cost_usd: 0.05 }),
    delta: { recall: 0.1, precision: 0, citation_accuracy: 0, cost_usd: 0.01 },
    system_prompt_a: "You are a security reviewer (v2).",
    system_prompt_b: "You are a security reviewer (v3).",
    cases_only_in_a: 0,
    cases_only_in_b: 0,
    ...overrides,
  };
}

describe("CompareModal", () => {
  it("renders the four old -> new stat deltas (AC-26)", () => {
    useEvalCompareMock.mockReturnValue({ data: compareData({}), isLoading: false, isError: false, refetch: vi.fn() });
    usePromoteAgentVersionMock.mockReturnValue({ mutate: vi.fn(), isPending: false });

    renderWithIntl();

    expect(screen.getByText("65%")).toBeInTheDocument(); // recall older
    expect(screen.getByText("75%")).toBeInTheDocument(); // recall newer
    expect(screen.getByText("$0.040")).toBeInTheDocument(); // cost older
    expect(screen.getByText("$0.050")).toBeInTheDocument(); // cost newer
  });

  it("reports cases only present in one side, so a delta isn't misattributed to the prompt alone (AC-29)", () => {
    useEvalCompareMock.mockReturnValue({
      data: compareData({ cases_only_in_a: 2, cases_only_in_b: 0 }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    usePromoteAgentVersionMock.mockReturnValue({ mutate: vi.fn(), isPending: false });

    renderWithIntl();

    expect(screen.getByText(/2 cases are only in this batch/)).toBeInTheDocument();
  });

  it("AC-28: degrades gracefully when a side's agent_version was never recorded — numeric deltas still render, prompt diff is replaced by a note, and Promote is disabled", () => {
    useEvalCompareMock.mockReturnValue({
      data: compareData({
        b: batchSummary({ batch_id: "batch-b", agent_version: null, recall: 0.75 }),
        system_prompt_b: null,
      }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    usePromoteAgentVersionMock.mockReturnValue({ mutate: vi.fn(), isPending: false });

    renderWithIntl();

    // Numeric deltas still render even though the newer side has no recorded version.
    expect(screen.getByText("65%")).toBeInTheDocument();
    expect(screen.getByText("75%")).toBeInTheDocument();

    // Prompt diff replaced with an explicit note on the side with no version.
    expect(screen.getAllByText("Version not recorded")).toHaveLength(1);
    expect(screen.getByText("You are a security reviewer (v2).")).toBeInTheDocument();

    // Promote is disabled and the reason is exposed to assistive technology.
    const promoteButton = screen.getByRole("button", { name: /Promote/ });
    expect(promoteButton).toBeDisabled();
    expect(promoteButton).toHaveAttribute(
      "title",
      "This version's config was not recorded and can't be promoted.",
    );
    const describedById = promoteButton.getAttribute("aria-describedby");
    expect(describedById).toBeTruthy();
    expect(document.getElementById(describedById!)).toHaveTextContent(
      "This version's config was not recorded and can't be promoted.",
    );
  });

  it("enables Promote v<newer> when the newer side has a recorded version", () => {
    useEvalCompareMock.mockReturnValue({ data: compareData({}), isLoading: false, isError: false, refetch: vi.fn() });
    usePromoteAgentVersionMock.mockReturnValue({ mutate: vi.fn(), isPending: false });

    renderWithIntl();

    const promoteButton = screen.getByRole("button", { name: "Promote v3" });
    expect(promoteButton).toBeEnabled();
  });
});
