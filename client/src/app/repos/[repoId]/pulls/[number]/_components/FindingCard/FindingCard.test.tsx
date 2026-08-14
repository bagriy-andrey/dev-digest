import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";

// Mock the eval-case-from-finding mutation with a static top-level import +
// a real `vi.fn()` whose return value is set per-test via `mockReturnValue`,
// reset in `afterEach` — NOT a module-level mutable `let` reassigned per test
// combined with a dynamic `await import(...)` inside each `it()`, which is a
// documented flaky pattern in this codebase (`client/insights.md`; mirrors
// `RunReviewDropdown.test.tsx`/`RiskAreasCard.test.tsx`).
const useCreateEvalCaseFromFindingMock = vi.fn();
vi.mock("@/lib/hooks/evals", () => ({
  useCreateEvalCaseFromFinding: () => useCreateEvalCaseFromFindingMock(),
}));

import { FindingCard } from "./FindingCard";

beforeEach(() => {
  useCreateEvalCaseFromFindingMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
});

afterEach(() => {
  cleanup();
  useCreateEvalCaseFromFindingMock.mockReset();
});

const FINDING: FindingRecord = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded Stripe secret key",
  file: "src/config.ts",
  start_line: 11,
  end_line: 11,
  rationale: "A **live** Stripe key is committed in source.",
  suggestion: "Move the key to an environment variable.",
  confidence: 0.95,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const DECIDED_FINDING_ACCEPTED: FindingRecord = { ...FINDING, accepted_at: "2026-07-20T00:00:00Z" };
const DECIDED_FINDING_DISMISSED: FindingRecord = { ...FINDING, dismissed_at: "2026-07-20T00:00:00Z" };

describe("FindingCard (smoke, both themes)", () => {
  (["dark", "light"] as const).forEach((theme) => {
    it(`renders severity + file:line + rationale in ${theme}`, () => {
      renderWithIntl(
        <div data-theme={theme}>
          <FindingCard f={FINDING} defaultExpanded onAction={() => {}} />
        </div>,
      );
      expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
      expect(screen.getByText("src/config.ts:11")).toBeInTheDocument();
      // category label is shown alongside the severity badge
      expect(screen.getByText("security")).toBeInTheDocument();
    });
  });

  it("fires accept/dismiss actions", () => {
    const onAction = vi.fn();
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={onAction} />);
    fireEvent.click(screen.getByText("Accept"));
    expect(onAction).toHaveBeenCalledWith("accept");
    fireEvent.click(screen.getByText("Dismiss"));
    expect(onAction).toHaveBeenCalledWith("dismiss");
  });

  it("clicking file:line opens it in the diff tab instead of linking to GitHub", () => {
    const onOpenInDiff = vi.fn();
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onOpenInDiff={onOpenInDiff} />);
    const fileLink = screen.getByText("src/config.ts:11");
    expect(fileLink.closest("a")).toBeNull();
    fireEvent.click(fileLink);
    expect(onOpenInDiff).toHaveBeenCalledWith("src/config.ts", 11);
    // it shouldn't also bubble to the header and collapse the card
    expect(screen.getByText("Move the key to an environment variable.")).toBeInTheDocument();
  });
});

describe("FindingCard — Turn into eval case (AC-1/AC-2)", () => {
  it("renders the action for an accepted finding", () => {
    renderWithIntl(<FindingCard f={DECIDED_FINDING_ACCEPTED} defaultExpanded onAction={() => {}} />);
    expect(screen.getByText("Turn into eval case")).toBeInTheDocument();
  });

  it("renders the action for a dismissed finding", () => {
    renderWithIntl(<FindingCard f={DECIDED_FINDING_DISMISSED} defaultExpanded onAction={() => {}} />);
    expect(screen.getByText("Turn into eval case")).toBeInTheDocument();
  });

  it("does not render the action for an undecided finding", () => {
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={() => {}} />);
    expect(screen.queryByText("Turn into eval case")).not.toBeInTheDocument();
  });

  it("calls the create-eval-case-from-finding mutation with the finding's id on click", () => {
    const mutate = vi.fn();
    useCreateEvalCaseFromFindingMock.mockReturnValue({ mutate, isPending: false });
    renderWithIntl(<FindingCard f={DECIDED_FINDING_ACCEPTED} defaultExpanded onAction={() => {}} />);
    fireEvent.click(screen.getByText("Turn into eval case"));
    expect(mutate).toHaveBeenCalledWith("f1", expect.objectContaining({ onSuccess: expect.any(Function) }));
  });

  it("disables the action while the mutation is pending", () => {
    useCreateEvalCaseFromFindingMock.mockReturnValue({ mutate: vi.fn(), isPending: true });
    renderWithIntl(<FindingCard f={DECIDED_FINDING_ACCEPTED} defaultExpanded onAction={() => {}} />);
    expect(screen.getByText("Turn into eval case").closest("button")).toBeDisabled();
  });
});
