import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/prReview.json";

const usePrBriefMock = vi.fn();
const useGenerateBriefMock = vi.fn();

vi.mock("@/lib/hooks/brief", () => ({
  usePrBrief: () => usePrBriefMock(),
  useGenerateBrief: () => useGenerateBriefMock(),
}));

import { PrBriefCard } from "./PrBriefCard";

beforeEach(() => {
  useGenerateBriefMock.mockReturnValue({ mutate: vi.fn(), isPending: false, isError: false });
});

afterEach(() => {
  cleanup();
  usePrBriefMock.mockReset();
  useGenerateBriefMock.mockReset();
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const populatedBrief = {
  what: "Adds rate limiting to the public API.",
  why: "Prevents abuse from unauthenticated clients hitting the search endpoint.",
  risk_level: "medium" as const,
  risks: [
    {
      kind: "security",
      title: "No backoff on repeated failures",
      explanation: "A client could still hammer the endpoint before the limiter kicks in.",
      severity: "medium" as const,
      file_refs: ["src/rl.ts"],
    },
  ],
  review_focus: [{ file: "src/rl.ts", reason: "Core rate-limit logic changed here." }],
};

describe("PrBriefCard", () => {
  it("shows a loading state", () => {
    usePrBriefMock.mockReturnValue({ data: undefined, isLoading: true });
    renderWithIntl(<PrBriefCard prId="pr1" repoId="r1" />);
    expect(screen.getByText("Loading brief…")).toBeInTheDocument();
  });

  it("shows the Generate CTA in the empty state, not an error", () => {
    usePrBriefMock.mockReturnValue({ data: null, isLoading: false });
    renderWithIntl(<PrBriefCard prId="pr1" repoId="r1" />);

    expect(screen.getByText(/No brief generated yet/)).toBeInTheDocument();
    expect(screen.getByText("Generate")).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't generate/)).not.toBeInTheDocument();
  });

  it("renders what/why/risk-level when a brief exists", () => {
    usePrBriefMock.mockReturnValue({ data: populatedBrief, isLoading: false });
    renderWithIntl(<PrBriefCard prId="pr1" repoId="r1" />);

    expect(screen.getByText(populatedBrief.what)).toBeInTheDocument();
    expect(screen.getByText(populatedBrief.why)).toBeInTheDocument();
    // Risk level renders as a labelled chip (text cue), not colour alone.
    expect(screen.getAllByText("Medium").length).toBeGreaterThan(0);

    // Risks and review_focus render in their own sections elsewhere on
    // Overview (RiskAreasCard/ReviewFocusSection) — not inside this card.
    expect(screen.queryByText("No backoff on repeated failures")).not.toBeInTheDocument();
    expect(screen.queryByText("Core rate-limit logic changed here.")).not.toBeInTheDocument();

    // Regenerate label once a brief exists.
    expect(screen.getByText("Regenerate")).toBeInTheDocument();
  });

  it("shows a pending state on the Regenerate button while generation is in flight", () => {
    usePrBriefMock.mockReturnValue({ data: populatedBrief, isLoading: false });
    useGenerateBriefMock.mockReturnValue({ mutate: vi.fn(), isPending: true, isError: false });
    renderWithIntl(<PrBriefCard prId="pr1" repoId="r1" />);

    expect(screen.getByText("Generating…")).toBeInTheDocument();
    expect(screen.queryByText("Regenerate")).not.toBeInTheDocument();
  });

  it("renders no token/cost/model figure anywhere in the card", () => {
    usePrBriefMock.mockReturnValue({ data: populatedBrief, isLoading: false });
    const { container } = renderWithIntl(<PrBriefCard prId="pr1" repoId="r1" />);

    const text = container.textContent ?? "";
    expect(text).not.toMatch(/token/i);
    expect(text).not.toMatch(/\$\d/);
    expect(text).not.toMatch(/cost/i);
  });

  it("renders a VerdictBanner above the brief text when latestReview is given", () => {
    usePrBriefMock.mockReturnValue({ data: populatedBrief, isLoading: false });
    renderWithIntl(
      <PrBriefCard
        prId="pr1"
        repoId="r1"
        latestReview={{
          verdict: "request_changes",
          summary: "Solid approach, but a secret key is committed in plaintext.",
          score: 61,
          findingsCount: 6,
          blockers: 2,
          agentName: "General Reviewer",
        }}
      />,
    );

    expect(screen.getByText("Request changes")).toBeInTheDocument();
    expect(screen.getByText("Solid approach, but a secret key is committed in plaintext.")).toBeInTheDocument();
    expect(screen.getByText("61")).toBeInTheDocument();
  });

  it("renders no VerdictBanner when latestReview is null (no review yet)", () => {
    usePrBriefMock.mockReturnValue({ data: populatedBrief, isLoading: false });
    renderWithIntl(<PrBriefCard prId="pr1" repoId="r1" latestReview={null} />);

    expect(screen.queryByText("Request changes")).not.toBeInTheDocument();
  });
});
