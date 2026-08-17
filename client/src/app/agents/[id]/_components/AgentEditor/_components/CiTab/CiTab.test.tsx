import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import ciMessages from "../../../../../../../../messages/en/ci.json";

// ---- Mocks (static top-level + vi.fn().mockReturnValue per test — per
// client/insights.md's TanStack Query mocking guidance). ----
const useCiInstallationsMock = vi.fn();
const useUpdateAgentMock = vi.fn();
vi.mock("@/lib/hooks", () => ({
  useCiInstallations: (...args: unknown[]) => useCiInstallationsMock(...args),
  useUpdateAgent: (...args: unknown[]) => useUpdateAgentMock(...args),
}));

// ExportWizard has its own dedicated test suite — stub it here to prove the
// tab's two actions open it (AC-36), without pulling in its network/step
// state machine.
vi.mock("@/components/ci/ExportWizard", () => ({
  ExportWizard: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="export-wizard">
      <button onClick={onClose}>close-wizard</button>
    </div>
  ),
}));

import { CiTab } from "./CiTab";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const AGENT: Agent = {
  id: "agent-1",
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

function renderWithIntl(ui: React.ReactElement) {
  return render(<NextIntlClientProvider locale="en" messages={{ ci: ciMessages }}>{ui}</NextIntlClientProvider>);
}

describe("CiTab", () => {
  it("shows the header, installed-in-N pill, and Update/Add-to-CI actions (AC-36)", () => {
    useCiInstallationsMock.mockReturnValue({ data: [], isLoading: false });
    useUpdateAgentMock.mockReturnValue({ mutate: vi.fn() });

    renderWithIntl(<CiTab agent={AGENT} />);

    expect(screen.getByText("CI deployment")).toBeInTheDocument();
    expect(screen.getByText("Installed in 0 repositories")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update CI config" })).toBeInTheDocument();
    // Zero installations also renders the empty-state's own "+ Add to CI"
    // CTA (legitimate duplication, not a bug — see client/insights.md) —
    // assert both the header action and the empty-state CTA exist.
    expect(screen.getAllByRole("button", { name: /Add to CI/ })).toHaveLength(2);
  });

  it("opens the ExportWizard from either action (AC-36)", () => {
    useCiInstallationsMock.mockReturnValue({ data: [], isLoading: false });
    useUpdateAgentMock.mockReturnValue({ mutate: vi.fn() });

    renderWithIntl(<CiTab agent={AGENT} />);
    expect(screen.queryByTestId("export-wizard")).not.toBeInTheDocument();

    // The header's primary action is the first "+ Add to CI" button in DOM
    // order (the empty-state's own CTA below it is a second, equivalent
    // trigger for the same wizard).
    fireEvent.click(screen.getAllByRole("button", { name: /Add to CI/ })[0]!);
    expect(screen.getByTestId("export-wizard")).toBeInTheDocument();
  });

  it("renders an empty state with the + Add to CI CTA when there are zero installations, not an error (AC-37)", () => {
    useCiInstallationsMock.mockReturnValue({ data: [], isLoading: false });
    useUpdateAgentMock.mockReturnValue({ mutate: vi.fn() });

    renderWithIntl(<CiTab agent={AGENT} />);

    expect(
      screen.getByText("Not deployed to CI yet — use “+ Add to CI” to open a PR that adds the workflow + agent config to a repo."),
    ).toBeInTheDocument();
  });

  it("renders one row per installation with repo, target badge, and latest run status + relative time (AC-37)", () => {
    useCiInstallationsMock.mockReturnValue({
      data: [
        {
          id: "inst-1",
          agent_id: "agent-1",
          repo: "acme/payments-api",
          target_type: "gha",
          installed_at: "2026-08-01T00:00:00.000Z",
          agent_name: "Security Reviewer",
          latest_run: {
            id: "run-1",
            ci_installation_id: "inst-1",
            pr_number: 42,
            ran_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
            status: "succeeded",
            findings_count: 2,
            cost_usd: 0.02,
            github_url: "https://github.com/acme/payments-api/actions/runs/1",
            source: "ci",
          },
        },
      ],
      isLoading: false,
    });
    useUpdateAgentMock.mockReturnValue({ mutate: vi.fn() });

    renderWithIntl(<CiTab agent={AGENT} />);

    expect(screen.getByText("acme/payments-api")).toBeInTheDocument();
    expect(screen.getByText("gha")).toBeInTheDocument();
    expect(screen.getByText("Succeeded")).toBeInTheDocument();
    expect(screen.getByText("3h")).toBeInTheDocument();
    expect(screen.queryByText("Not deployed to CI yet")).not.toBeInTheDocument();
  });

  it("renders the Fail-CI-on selector bound to agent.ci_fail_on with all four options, fires the update mutation on change, and shows the stale-manifest notice (AC-38/AC-39)", () => {
    useCiInstallationsMock.mockReturnValue({ data: [], isLoading: false });
    const mutate = vi.fn();
    useUpdateAgentMock.mockReturnValue({ mutate });

    renderWithIntl(<CiTab agent={AGENT} />);

    const select = screen.getByDisplayValue("Critical findings") as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    const optionLabels = Array.from(select.options).map((o) => o.textContent);
    expect(optionLabels).toEqual([
      "Never (report only)",
      "Critical findings",
      "Warning findings or above",
      "Any finding",
    ]);

    fireEvent.change(select, { target: { value: "any" } });
    expect(mutate).toHaveBeenCalledWith({ id: "agent-1", patch: { ci_fail_on: "any" } });

    // AC-39 — must not imply installed repos were live-updated.
    expect(
      screen.getByText(
        "Installed repos keep running the manifest from their last export — re-run the wizard to push a config change.",
      ),
    ).toBeInTheDocument();
  });
});
