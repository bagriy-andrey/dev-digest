import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/prReview.json";

const usePrBriefMock = vi.fn();

vi.mock("@/lib/hooks/brief", () => ({
  usePrBrief: () => usePrBriefMock(),
}));

import { ReviewFocusSection } from "./ReviewFocusSection";

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
  risks: [],
  review_focus: [
    { file: "src/config.ts", reason: "live Stripe key committed in plaintext" },
    { file: "src/api/users.ts", reason: "N+1 query — one posts lookup per user" },
  ],
};

describe("ReviewFocusSection", () => {
  it("renders nothing when there's no brief yet", () => {
    usePrBriefMock.mockReturnValue({ data: null });
    const { container } = renderWithIntl(<ReviewFocusSection prId="pr1" onOpenInDiff={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the brief has zero review_focus items", () => {
    usePrBriefMock.mockReturnValue({ data: { ...brief, review_focus: [] } });
    const { container } = renderWithIntl(<ReviewFocusSection prId="pr1" onOpenInDiff={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders one line per item with a count badge", () => {
    usePrBriefMock.mockReturnValue({ data: brief });
    renderWithIntl(<ReviewFocusSection prId="pr1" onOpenInDiff={vi.fn()} />);

    expect(screen.getByText("src/config.ts")).toBeInTheDocument();
    expect(screen.getByText("live Stripe key committed in plaintext")).toBeInTheDocument();
    expect(screen.getByText("src/api/users.ts")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("calls onOpenInDiff with the file (and no line) when an item is clicked", () => {
    const onOpenInDiff = vi.fn();
    usePrBriefMock.mockReturnValue({ data: brief });
    renderWithIntl(<ReviewFocusSection prId="pr1" onOpenInDiff={onOpenInDiff} />);

    fireEvent.click(screen.getByText("src/config.ts"));
    expect(onOpenInDiff).toHaveBeenCalledWith("src/config.ts", null);
  });
});
