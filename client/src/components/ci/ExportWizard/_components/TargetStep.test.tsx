import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import ciMessages from "../../../../../messages/en/ci.json";
import type { CiTarget } from "@/lib/types";

// Static top-level mock + vi.fn().mockReturnValue reset in afterEach — per
// client/insights.md's TanStack Query mocking guidance (never a module-level
// `let` + dynamic `import()`, which is flaky under this repo's full suite).
const useReposMock = vi.fn();
vi.mock("@/lib/hooks", () => ({
  useRepos: (...args: unknown[]) => useReposMock(...args),
}));

import { TargetStep, type ConflictInstallation } from "./TargetStep";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const CONNECTED_REPOS = [
  { id: "r1", workspace_id: "w1", owner: "acme", name: "payments-api", full_name: "acme/payments-api" },
  { id: "r2", workspace_id: "w1", owner: "acme", name: "billing-worker", full_name: "acme/billing-worker" },
];

function mockDefaults() {
  useReposMock.mockReturnValue({ data: CONNECTED_REPOS, isSuccess: true });
}

/** Opens the repo SearchableSelect, filters, and picks `fullName`. */
function selectRepo(fullName: string) {
  fireEvent.click(screen.getByText(ciMessages.exportWizard.repoSearch));
  const input = screen.getByPlaceholderText(ciMessages.exportWizard.repoSearch);
  fireEvent.change(input, { target: { value: fullName } });
  fireEvent.click(screen.getByRole("button", { name: fullName }));
}

function Harness({
  initialTarget = "gha" as CiTarget,
  conflict = null as ConflictInstallation | null,
}) {
  const [target, setTarget] = React.useState<CiTarget>(initialTarget);
  const [repo, setRepo] = React.useState("");
  const [confirmReplace, setConfirmReplace] = React.useState(false);
  return (
    <TargetStep
      target={target}
      onTargetChange={setTarget}
      repo={repo}
      onRepoChange={setRepo}
      conflict={conflict}
      confirmReplace={confirmReplace}
      onConfirmReplaceChange={setConfirmReplace}
    />
  );
}

function renderHarness(props: Parameters<typeof Harness>[0] = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ ci: ciMessages }}>
      <Harness {...props} />
    </NextIntlClientProvider>,
  );
}

describe("TargetStep", () => {
  it("renders all four targets with GitHub Actions marked recommended", () => {
    mockDefaults();
    renderHarness();
    expect(screen.getByText(ciMessages.exportWizard.targets.gha)).toBeInTheDocument();
    expect(screen.getByText(ciMessages.exportWizard.targets.circle)).toBeInTheDocument();
    expect(screen.getByText(ciMessages.exportWizard.targets.jenkins)).toBeInTheDocument();
    expect(screen.getByText(ciMessages.exportWizard.targets.cli)).toBeInTheDocument();
    expect(screen.getByText(ciMessages.exportWizard.recommended)).toBeInTheDocument();
  });

  it("selecting a non-GHA target shows the not-available copy", () => {
    mockDefaults();
    renderHarness();
    fireEvent.click(screen.getByText(ciMessages.exportWizard.targets.circle));
    expect(screen.getByText(ciMessages.exportWizard.notAvailableYet)).toBeInTheDocument();
  });

  it("the repo field is a dropdown sourced from repos already connected to the workspace", () => {
    mockDefaults();
    renderHarness();
    // Nothing selected yet — the trigger shows the search placeholder, not a
    // free-text caret; no arbitrary string can be typed into the closed field.
    expect(screen.getByText(ciMessages.exportWizard.repoSearch)).toBeInTheDocument();
    selectRepo("acme/payments-api");
    expect(screen.getByText("acme/payments-api")).toBeInTheDocument();
  });

  it("filters the connected-repo list as the user types", () => {
    mockDefaults();
    renderHarness();
    fireEvent.click(screen.getByText(ciMessages.exportWizard.repoSearch));
    const input = screen.getByPlaceholderText(ciMessages.exportWizard.repoSearch);
    fireEvent.change(input, { target: { value: "billing" } });
    expect(screen.getByRole("button", { name: "acme/billing-worker" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "acme/payments-api" })).not.toBeInTheDocument();
  });

  it("shows an empty-state hint instead of the dropdown hint when no repos are connected", () => {
    useReposMock.mockReturnValue({ data: [], isSuccess: true });
    renderHarness();
    expect(screen.getByText(ciMessages.exportWizard.repoEmptyHint)).toBeInTheDocument();
    expect(screen.queryByText(ciMessages.exportWizard.repoHint)).not.toBeInTheDocument();
  });

  it("shows the replace warning naming the other agent when a DIFFERENT agent already owns the repo (AC-26a)", () => {
    mockDefaults();
    renderHarness({
      conflict: {
        id: "inst-1",
        agent_id: "agent-other",
        repo: "acme/payments-api",
        target_type: "gha",
        installed_at: "2026-01-01T00:00:00.000Z",
        agent_name: "Other Agent",
      },
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Other Agent");
    expect(screen.getByText(ciMessages.exportWizard.replaceConfirm)).toBeInTheDocument();
  });

  it("does not show a conflict warning when there is none (e.g. same agent re-exporting)", () => {
    mockDefaults();
    renderHarness({ conflict: null });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
