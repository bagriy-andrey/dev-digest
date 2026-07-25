import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/prReview.json";

const usePrBriefMock = vi.fn();

vi.mock("@/lib/hooks/brief", () => ({
  usePrBrief: () => usePrBriefMock(),
}));

import { RiskAreasCard } from "./RiskAreasCard";

afterEach(() => {
  cleanup();
  usePrBriefMock.mockReset();
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const brief = {
  what: "x",
  why: "y",
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
  review_focus: [],
};

describe("RiskAreasCard", () => {
  it("renders nothing when there's no brief yet", () => {
    usePrBriefMock.mockReturnValue({ data: null });
    const { container } = renderWithIntl(<RiskAreasCard prId="pr1" onOpenInDiff={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the brief has zero risks", () => {
    usePrBriefMock.mockReturnValue({ data: { ...brief, risks: [] } });
    const { container } = renderWithIntl(<RiskAreasCard prId="pr1" onOpenInDiff={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders each risk's title and file_refs, with the explanation collapsed by default", () => {
    usePrBriefMock.mockReturnValue({ data: brief });
    renderWithIntl(<RiskAreasCard prId="pr1" onOpenInDiff={vi.fn()} />);

    expect(screen.getByText("No backoff on repeated failures")).toBeInTheDocument();
    expect(screen.getByText("src/rl.ts")).toBeInTheDocument();
    expect(screen.queryByText(/A client could still hammer/)).not.toBeInTheDocument();
  });

  it("reveals the explanation when the row is clicked", () => {
    usePrBriefMock.mockReturnValue({ data: brief });
    renderWithIntl(<RiskAreasCard prId="pr1" onOpenInDiff={vi.fn()} />);

    fireEvent.click(screen.getByText("No backoff on repeated failures"));
    expect(screen.getByText(/A client could still hammer/)).toBeInTheDocument();
  });

  it("calls onOpenInDiff with the file (and no line) when a file_ref is clicked", () => {
    const onOpenInDiff = vi.fn();
    usePrBriefMock.mockReturnValue({ data: brief });
    renderWithIntl(<RiskAreasCard prId="pr1" onOpenInDiff={onOpenInDiff} />);

    fireEvent.click(screen.getByText("src/rl.ts"));
    expect(onOpenInDiff).toHaveBeenCalledWith("src/rl.ts", null);
  });
});
