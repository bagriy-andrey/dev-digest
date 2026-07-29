import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import type { EvalCase } from "@/lib/types";
import evalMessages from "../../../../../../../../messages/en/eval.json";

const useCreateEvalCaseMock = vi.fn();
const useUpdateEvalCaseMock = vi.fn();
const useRunEvalCaseMock = vi.fn();
const useEvalRunsMock = vi.fn();

vi.mock("@/lib/hooks/evals", () => ({
  useCreateEvalCase: (...args: unknown[]) => useCreateEvalCaseMock(...args),
  useUpdateEvalCase: (...args: unknown[]) => useUpdateEvalCaseMock(...args),
  useRunEvalCase: (...args: unknown[]) => useRunEvalCaseMock(...args),
  useEvalRuns: (...args: unknown[]) => useEvalRunsMock(...args),
}));

import { CaseEditorModal } from "./CaseEditorModal";

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

const EXISTING_CASE: EvalCase = {
  id: "case-1",
  owner_kind: "agent",
  owner_id: "ag1",
  name: "Stripe key leak",
  input_diff: "--- a/src/config.ts\n+++ b/src/config.ts",
  input_files: [{ path: "src/config.ts", additions: 1, deletions: 0 }],
  input_meta: { pr_title: "Add Stripe integration", pr_body: "Wire up payments." },
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

function mockDefaults() {
  useCreateEvalCaseMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
  useUpdateEvalCaseMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
  useRunEvalCaseMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
  useEvalRunsMock.mockReturnValue({ data: [] });
}

function renderModal(evalCase: EvalCase | null, onClose = vi.fn()) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      <CaseEditorModal agent={AGENT} evalCase={evalCase} onClose={onClose} />
    </NextIntlClientProvider>,
  );
}

describe("CaseEditorModal", () => {
  it("shows the valid-JSON indicator for a well-formed existing case", () => {
    mockDefaults();
    renderModal(EXISTING_CASE);

    expect(screen.getByText(evalMessages.caseEditor.validJson)).toBeInTheDocument();
    expect(screen.queryByText(evalMessages.caseEditor.invalidJson)).not.toBeInTheDocument();
  });

  it("flips to the invalid-JSON indicator and shows an error when the textarea holds malformed JSON", () => {
    mockDefaults();
    renderModal(EXISTING_CASE);

    const textarea = screen.getByDisplayValue(/must_find/);
    fireEvent.change(textarea, { target: { value: "{ not valid json" } });

    expect(screen.getByText(evalMessages.caseEditor.invalidJson)).toBeInTheDocument();
    expect(screen.queryByText(evalMessages.caseEditor.validJson)).not.toBeInTheDocument();
  });

  it("rejects a JSON value that doesn't match the expectation contract shape", () => {
    mockDefaults();
    renderModal(EXISTING_CASE);

    const textarea = screen.getByDisplayValue(/must_find/);
    fireEvent.change(textarea, { target: { value: '[{"file": 123}]' } });

    expect(screen.getByText(evalMessages.caseEditor.invalidJson)).toBeInTheDocument();
  });

  it("'+ Finding skeleton' inserts a blank must_find stub into the JSON", () => {
    mockDefaults();
    renderModal(null);

    fireEvent.click(screen.getByText(evalMessages.caseEditor.insertSkeleton));

    // The stub's `file` is intentionally blank (least-typing skeleton), which
    // fails the contract's `file: z.string().min(1)` until the user fills it
    // in — so the indicator correctly flips to invalid right after insertion.
    const textarea = screen.getByDisplayValue(/"kind": "must_find"/);
    expect(textarea).toBeInTheDocument();
    expect(screen.getByText(evalMessages.caseEditor.invalidJson)).toBeInTheDocument();
  });

  it("create mode: Save calls useCreateEvalCase with the entered name and parsed expected_output", () => {
    mockDefaults();
    const create = vi.fn();
    useCreateEvalCaseMock.mockReturnValue({ mutate: create, isPending: false });
    const onClose = vi.fn();
    renderModal(null, onClose);

    fireEvent.change(screen.getByPlaceholderText(evalMessages.caseEditor.namePlaceholder), {
      target: { value: "New case" },
    });
    fireEvent.click(screen.getByText(evalMessages.caseEditor.save));

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "ag1",
        input: expect.objectContaining({ owner_kind: "agent", owner_id: "ag1", name: "New case" }),
      }),
      expect.anything(),
    );
  });

  it("edit mode: Save calls useUpdateEvalCase, and triggers a run when 'Run on save' is on", () => {
    mockDefaults();
    const update = vi.fn((_vars, opts?: { onSuccess?: (c: EvalCase) => void }) => {
      opts?.onSuccess?.(EXISTING_CASE);
    });
    const runCase = vi.fn();
    useUpdateEvalCaseMock.mockReturnValue({ mutate: update, isPending: false });
    useRunEvalCaseMock.mockReturnValue({ mutate: runCase, isPending: false });
    const onClose = vi.fn();

    renderModal(EXISTING_CASE, onClose);

    fireEvent.click(screen.getByRole("switch")); // Run on save
    fireEvent.click(screen.getByText(evalMessages.caseEditor.save));

    expect(update).toHaveBeenCalled();
    expect(runCase).toHaveBeenCalledWith({ agentId: "ag1", caseId: "case-1" });
    expect(onClose).toHaveBeenCalled();
  });

  it("renders the last-run status strip once a run exists for this case", () => {
    mockDefaults();
    useEvalRunsMock.mockReturnValue({
      data: [
        {
          id: "run-1",
          case_id: "case-1",
          case_name: "Stripe key leak",
          ran_at: "2026-07-20T00:00:00.000Z",
          actual_output: {
            findings: [],
            counts: { must_find: 1, matched: 1, actual: 1, noise: 0, dropped: 0 },
            model: "gpt-4.1",
            error: null,
          },
          pass: true,
          recall: 1,
          precision: 1,
          citation_accuracy: 1,
          duration_ms: 900,
          cost_usd: 0.004,
          batch_id: "batch-1",
          agent_version: 1,
        },
      ],
    });

    renderModal(EXISTING_CASE);

    expect(screen.getByText(evalMessages.caseEditor.lastRunPassed)).toBeInTheDocument();
  });
});
