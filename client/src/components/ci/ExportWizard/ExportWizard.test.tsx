import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import ciMessages from "../../../../messages/en/ci.json";
import type { CiExport, CiFile } from "@/lib/types";

// ---- Mocks (static top-level + vi.fn().mockReturnValue per test — per
// client/insights.md's TanStack Query mocking guidance: never a module-level
// `let` + dynamic `import()`, which is flaky under this repo's full suite.)
const useCiInstallationsMock = vi.fn();
const useExportCiMock = vi.fn();

vi.mock("@/lib/hooks", () => ({
  useCiInstallations: (...args: unknown[]) => useCiInstallationsMock(...args),
  useExportCi: (...args: unknown[]) => useExportCiMock(...args),
}));

import { ExportWizard } from "./ExportWizard";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const AGENT_ID = "agent-this";
const OTHER_AGENT_ID = "agent-other";
const AGENT_NAME = "Security Reviewer";
const REPO = "acme/payments-api";

const FILES: CiFile[] = [
  { path: ".devdigest/agents/security-reviewer.yaml", contents: "name: Security Reviewer", editable: true },
  { path: ".devdigest/skills/security-rules.md", contents: "# Security Rules", editable: true },
  { path: ".devdigest/memory.jsonl", contents: "", editable: true },
  { path: ".devdigest/runner/index.js", contents: "/* huge minified runner */", editable: false },
  { path: ".github/workflows/devdigest-review.yml", contents: "name: DevDigest Review", editable: true },
];

function exportResult(overrides: Partial<CiExport> = {}): CiExport {
  return {
    installation: {
      id: "",
      agent_id: AGENT_ID,
      repo: REPO,
      target_type: "gha",
      installed_at: "2026-01-01T00:00:00.000Z",
    },
    files: FILES,
    pr_url: null,
    ...overrides,
  };
}

function mockDefaults() {
  useCiInstallationsMock.mockReturnValue({ data: [] });
  useExportCiMock.mockReturnValue({
    mutate: vi.fn((_vars, opts) => opts?.onSuccess?.(exportResult())),
    isPending: false,
  });
}

function renderWizard() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ ci: ciMessages }}>
      <ExportWizard agentId={AGENT_ID} agentName={AGENT_NAME} onClose={vi.fn()} />
    </NextIntlClientProvider>,
  );
}

function fillRepo(value: string) {
  fireEvent.change(screen.getByPlaceholderText(ciMessages.exportWizard.repoPlaceholder), {
    target: { value },
  });
}

function clickContinue() {
  fireEvent.click(screen.getByText(ciMessages.exportWizard.continue));
}

describe("ExportWizard", () => {
  it("renders the four ExportWizardSteps labels", () => {
    mockDefaults();
    renderWizard();
    expect(screen.getByText(ciMessages.exportWizard.steps.target)).toBeInTheDocument();
    expect(screen.getByText(ciMessages.exportWizard.steps.preview)).toBeInTheDocument();
    expect(screen.getByText(ciMessages.exportWizard.steps.configure)).toBeInTheDocument();
    expect(screen.getByText(ciMessages.exportWizard.steps.install)).toBeInTheDocument();
  });

  it("fetches no repo list — useCiInstallations is called unfiltered, and the repo field is free text", () => {
    mockDefaults();
    renderWizard();
    expect(useCiInstallationsMock).toHaveBeenCalledWith();
    const input = screen.getByPlaceholderText(ciMessages.exportWizard.repoPlaceholder);
    expect(input.tagName).toBe("INPUT");
    fillRepo(REPO);
    expect(screen.getByDisplayValue(REPO)).toBeInTheDocument();
  });

  it("Continue is disabled for a non-GHA target even with a valid repo (AC-26)", () => {
    mockDefaults();
    renderWizard();
    fillRepo(REPO);
    fireEvent.click(screen.getByText(ciMessages.exportWizard.targets.circle));
    expect(screen.getByText(ciMessages.exportWizard.continue)).toBeDisabled();
  });

  it("warns when a DIFFERENT agent already runs in the typed repo, and blocks Continue until confirmed (AC-26a)", () => {
    mockDefaults();
    useCiInstallationsMock.mockReturnValue({
      data: [
        {
          id: "inst-1",
          agent_id: OTHER_AGENT_ID,
          repo: REPO,
          target_type: "gha",
          installed_at: "2026-01-01T00:00:00.000Z",
          agent_name: "Other Agent",
        },
      ],
    });
    renderWizard();
    fillRepo(REPO);

    expect(screen.getByRole("alert")).toHaveTextContent("Other Agent");
    expect(screen.getByText(ciMessages.exportWizard.continue)).toBeDisabled();

    const confirmBox = screen
      .getByText(ciMessages.exportWizard.replaceConfirm)
      .closest("label")
      ?.querySelector('[role="checkbox"]');
    fireEvent.click(confirmBox as HTMLElement);

    expect(screen.getByText(ciMessages.exportWizard.continue)).not.toBeDisabled();
  });

  it("does not warn when the SAME agent already runs in the typed repo (a normal update)", () => {
    mockDefaults();
    useCiInstallationsMock.mockReturnValue({
      data: [
        {
          id: "inst-1",
          agent_id: AGENT_ID,
          repo: REPO,
          target_type: "gha",
          installed_at: "2026-01-01T00:00:00.000Z",
          agent_name: AGENT_NAME,
        },
      ],
    });
    renderWizard();
    fillRepo(REPO);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText(ciMessages.exportWizard.continue)).not.toBeDisabled();
  });

  it("lists all five files with the workflow selected by default, and the runner bundle is not editable or rendered (AC-27/28)", () => {
    mockDefaults();
    renderWizard();
    fillRepo(REPO);
    clickContinue();

    for (const f of FILES) {
      // The selected file's path also appears as the code-view's label —
      // assert presence, not uniqueness.
      expect(screen.getAllByText(f.path).length).toBeGreaterThan(0);
    }
    // Workflow selected by default → its contents show in the (editable) code view.
    expect(screen.getByDisplayValue("name: DevDigest Review")).toBeInTheDocument();

    // Selecting the runner bundle shows the placeholder, never its real contents.
    fireEvent.click(screen.getAllByText(".devdigest/runner/index.js")[0]!);
    expect(screen.getByText(ciMessages.exportWizard.runnerNotPreviewable)).toBeInTheDocument();
    expect(screen.queryByText("/* huge minified runner */")).not.toBeInTheDocument();
  });

  it("Back → forward preserves every choice made across steps (AC-25)", () => {
    mockDefaults();
    renderWizard();

    fillRepo(REPO);
    clickContinue(); // → Preview
    clickContinue(); // → Configure

    const reopenedBox = screen
      .getByText(ciMessages.exportWizard.triggers.reopened)
      .closest("label")
      ?.querySelector('[role="checkbox"]') as HTMLElement;
    fireEvent.click(reopenedBox);
    expect(reopenedBox).toHaveAttribute("aria-checked", "true");

    // Back to Preview, back to Target.
    fireEvent.click(screen.getByText(ciMessages.exportWizard.back));
    fireEvent.click(screen.getByText(ciMessages.exportWizard.back));
    expect(screen.getByDisplayValue(REPO)).toBeInTheDocument();

    // Forward again — the reopened trigger is still checked.
    clickContinue(); // → Preview
    clickContinue(); // → Configure
    const reopenedBoxAgain = screen
      .getByText(ciMessages.exportWizard.triggers.reopened)
      .closest("label")
      ?.querySelector('[role="checkbox"]');
    expect(reopenedBoxAgain).toHaveAttribute("aria-checked", "true");
  });

  it("sends edited file contents in the Install mutation's files payload (AC-29, client half)", () => {
    mockDefaults();
    const mutateSpy = vi.fn((_vars, opts) => opts?.onSuccess?.(exportResult({ pr_url: "https://github.com/acme/payments-api/pull/7" })));
    useExportCiMock.mockReturnValue({ mutate: mutateSpy, isPending: false });

    renderWizard();
    fillRepo(REPO);
    clickContinue(); // → Preview (first mutate call, action:'files')

    const workflowTextarea = screen.getByDisplayValue("name: DevDigest Review");
    fireEvent.change(workflowTextarea, { target: { value: "name: Edited Workflow" } });

    clickContinue(); // → Configure
    clickContinue(); // → Install

    fireEvent.click(screen.getByRole("button", { name: ciMessages.exportWizard.install }));

    expect(mutateSpy).toHaveBeenCalledTimes(2);
    const installCallInput = mutateSpy.mock.calls[1]?.[0]?.input;
    expect(installCallInput.action).toBe("open_pr");
    expect(installCallInput.files).toEqual([
      {
        path: ".github/workflows/devdigest-review.yml",
        contents: "name: Edited Workflow",
        editable: true,
      },
    ]);
  });

  it("surfaces the PR URL once Install succeeds (AC-34)", () => {
    mockDefaults();
    const mutateSpy = vi.fn((_vars, opts) =>
      opts?.onSuccess?.(exportResult({ pr_url: "https://github.com/acme/payments-api/pull/9" })),
    );
    useExportCiMock.mockReturnValue({ mutate: mutateSpy, isPending: false });

    renderWizard();
    fillRepo(REPO);
    clickContinue(); // → Preview
    clickContinue(); // → Configure
    clickContinue(); // → Install
    fireEvent.click(screen.getByRole("button", { name: ciMessages.exportWizard.install }));

    expect(screen.getByText(ciMessages.exportWizard.installedPr)).toBeInTheDocument();
    const link = screen.getByText(ciMessages.exportWizard.viewPr).closest("a");
    expect(link).toHaveAttribute("href", "https://github.com/acme/payments-api/pull/9");
  });
});
