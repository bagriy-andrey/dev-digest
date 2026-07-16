import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
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
    renderWithIntl(<PrBriefCard prId="pr1" repoId="r1" onOpenInDiff={vi.fn()} />);
    expect(screen.getByText("Loading brief…")).toBeInTheDocument();
  });

  it("shows the Generate CTA in the empty state, not an error", () => {
    usePrBriefMock.mockReturnValue({ data: null, isLoading: false });
    renderWithIntl(<PrBriefCard prId="pr1" repoId="r1" onOpenInDiff={vi.fn()} />);

    expect(screen.getByText(/No brief generated yet/)).toBeInTheDocument();
    expect(screen.getByText("Generate")).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't generate/)).not.toBeInTheDocument();
  });

  it("renders what/why/risk-level/risks/review_focus when a brief exists", () => {
    usePrBriefMock.mockReturnValue({ data: populatedBrief, isLoading: false });
    renderWithIntl(<PrBriefCard prId="pr1" repoId="r1" onOpenInDiff={vi.fn()} />);

    expect(screen.getByText(populatedBrief.what)).toBeInTheDocument();
    expect(screen.getByText(populatedBrief.why)).toBeInTheDocument();
    // Risk level renders as a labelled chip (text cue), not colour alone.
    expect(screen.getAllByText("Medium").length).toBeGreaterThan(0);
    expect(screen.getByText("No backoff on repeated failures")).toBeInTheDocument();
    expect(screen.getByText("A client could still hammer the endpoint before the limiter kicks in.")).toBeInTheDocument();
    expect(screen.getByText("src/rl.ts")).toBeInTheDocument();
    expect(screen.getByText("Core rate-limit logic changed here.")).toBeInTheDocument();

    // Regenerate label once a brief exists.
    expect(screen.getByText("Regenerate")).toBeInTheDocument();
  });

  it("calls onOpenInDiff with the file (and no line) when a review_focus item is clicked", () => {
    const onOpenInDiff = vi.fn();
    usePrBriefMock.mockReturnValue({ data: populatedBrief, isLoading: false });
    renderWithIntl(<PrBriefCard prId="pr1" repoId="r1" onOpenInDiff={onOpenInDiff} />);

    fireEvent.click(screen.getByText("src/rl.ts"));
    expect(onOpenInDiff).toHaveBeenCalledWith("src/rl.ts", null);
  });

  it("shows a pending state on the Regenerate button while generation is in flight", () => {
    usePrBriefMock.mockReturnValue({ data: populatedBrief, isLoading: false });
    useGenerateBriefMock.mockReturnValue({ mutate: vi.fn(), isPending: true, isError: false });
    renderWithIntl(<PrBriefCard prId="pr1" repoId="r1" onOpenInDiff={vi.fn()} />);

    expect(screen.getByText("Generating…")).toBeInTheDocument();
    expect(screen.queryByText("Regenerate")).not.toBeInTheDocument();
  });

  it("renders no token/cost/model figure anywhere in the card", () => {
    usePrBriefMock.mockReturnValue({ data: populatedBrief, isLoading: false });
    const { container } = renderWithIntl(<PrBriefCard prId="pr1" repoId="r1" onOpenInDiff={vi.fn()} />);

    const text = container.textContent ?? "";
    expect(text).not.toMatch(/token/i);
    expect(text).not.toMatch(/\$\d/);
    expect(text).not.toMatch(/cost/i);
  });
});
