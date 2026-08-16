import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import ciMessages from "../../../../../messages/en/ci.json";
import type { CiRunRow } from "@/lib/hooks/ci";

// ---- Mocks (static top-level + vi.fn().mockReturnValue per test — per
// client/insights.md's TanStack Query mocking guidance). ----
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const useCiRunsMock = vi.fn();
const useRefreshCiRunsMock = vi.fn();
vi.mock("@/lib/hooks", () => ({
  useCiRuns: (...args: unknown[]) => useCiRunsMock(...args),
  useRefreshCiRuns: (...args: unknown[]) => useRefreshCiRunsMock(...args),
}));

import { CiRunsPage } from "./CiRunsPage";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderWithIntl() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ ci: ciMessages }}>
      <CiRunsPage />
    </NextIntlClientProvider>,
  );
}

const RUN: CiRunRow = {
  id: "run-1",
  ci_installation_id: "inst-1",
  pr_number: 42,
  ran_at: "2026-08-15T10:00:00.000Z",
  status: "succeeded",
  findings_count: 3,
  cost_usd: 0.012,
  github_url: "https://github.com/acme/payments-api/actions/runs/999",
  source: "ci",
  agent: "Security Reviewer",
  duration_s: 12.5,
  repo: "acme/payments-api",
};

describe("CiRunsPage", () => {
  it("renders a row with PR, repo, agent, status, findings, cost, duration and a working Actions link (AC-40)", () => {
    useCiRunsMock.mockReturnValue({ data: [RUN], isLoading: false });
    useRefreshCiRunsMock.mockReturnValue({ mutate: vi.fn(), isPending: false });

    renderWithIntl();

    expect(screen.getByText("#42")).toBeInTheDocument();
    expect(screen.getByText("acme/payments-api")).toBeInTheDocument();
    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByText("Succeeded")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("$0.012")).toBeInTheDocument();
    expect(screen.getByText("12.5s")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /View job/ });
    expect(link).toHaveAttribute("href", "https://github.com/acme/payments-api/actions/runs/999");
  });

  it("renders the explicit unknown marker for a null cost/duration, never 0 (AC-41)", () => {
    useCiRunsMock.mockReturnValue({
      data: [{ ...RUN, cost_usd: null, duration_s: null }],
      isLoading: false,
    });
    useRefreshCiRunsMock.mockReturnValue({ mutate: vi.fn(), isPending: false });

    renderWithIntl();

    const unknownCells = screen.getAllByText("unknown");
    expect(unknownCells.length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
    expect(screen.queryByText("0s")).not.toBeInTheDocument();
  });

  it("renders the how-runs-arrive empty state when there are no runs, not an error (AC-42)", () => {
    useCiRunsMock.mockReturnValue({ data: [], isLoading: false });
    useRefreshCiRunsMock.mockReturnValue({ mutate: vi.fn(), isPending: false });

    renderWithIntl();

    expect(screen.getByText("No CI runs yet")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Export an agent to CI, merge the pull request it opens, then open a PR in the target repo — its review will land here.",
      ),
    ).toBeInTheDocument();
  });

  it("Refresh calls the mutation and shows an in-progress state while pending (AC-43)", () => {
    useCiRunsMock.mockReturnValue({ data: [RUN], isLoading: false });
    const mutate = vi.fn();
    useRefreshCiRunsMock.mockReturnValue({ mutate, isPending: false });

    const { rerender } = renderWithIntl();
    // One call already fired on mount (spec: "fine to also fire once on
    // mount") — the button click must add a second, user-triggered call.
    expect(mutate).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(mutate).toHaveBeenCalledTimes(2);

    useRefreshCiRunsMock.mockReturnValue({ mutate, isPending: true });
    rerender(
      <NextIntlClientProvider locale="en" messages={{ ci: ciMessages }}>
        <CiRunsPage />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("Refreshing…")).toBeInTheDocument();
  });
});
