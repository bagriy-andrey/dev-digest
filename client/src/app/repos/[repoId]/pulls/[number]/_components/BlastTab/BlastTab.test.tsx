import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/prReview.json";

const usePrBlastMock = vi.fn();
const useSummarizeBlastMock = vi.fn();

vi.mock("@/lib/hooks", () => ({
  usePrBlast: () => usePrBlastMock(),
  useSummarizeBlast: () => useSummarizeBlastMock(),
}));

import { BlastTab } from "./BlastTab";

beforeEach(() => {
  useSummarizeBlastMock.mockReturnValue({ mutate: vi.fn(), isPending: false, isError: false });
});

afterEach(() => {
  cleanup();
  usePrBlastMock.mockReset();
  useSummarizeBlastMock.mockReset();
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const SAMPLE_BLAST = {
  changed_symbols: [{ name: "rateLimit", file: "src/rl.ts", kind: "function" }],
  downstream: [
    {
      symbol: "rateLimit",
      callers: [
        { name: "handler", file: "src/api/index.ts", line: 23 },
        { name: "webhook", file: "src/api/webhooks.ts", line: 45 },
      ],
      endpoints_affected: ["GET /api/items"],
      crons_affected: ["reset-rate-buckets"],
    },
  ],
  prior_prs: [],
  summary: "",
};

describe("BlastTab", () => {
  it("shows an empty state when there are no changed symbols", () => {
    usePrBlastMock.mockReturnValue({
      data: { changed_symbols: [], downstream: [], prior_prs: [], summary: "" },
      isLoading: false,
    });
    renderWithIntl(<BlastTab prId="pr1" repoId="r1" onOpenInDiff={vi.fn()} />);
    expect(screen.getByText(/No blast radius data/)).toBeInTheDocument();
  });

  it("defaults to Tree view with untruncated caller and endpoint/cron lists", () => {
    usePrBlastMock.mockReturnValue({ data: SAMPLE_BLAST, isLoading: false });
    renderWithIntl(<BlastTab prId="pr1" repoId="r1" onOpenInDiff={vi.fn()} />);

    expect(screen.getByText("src/api/index.ts:23")).toBeInTheDocument();
    expect(screen.getByText("src/api/webhooks.ts:45")).toBeInTheDocument();
    expect(screen.getByText("GET /api/items")).toBeInTheDocument();
    expect(screen.getByText("reset-rate-buckets")).toBeInTheDocument();
    // Graph SVG is not rendered while in Tree view.
    expect(screen.queryByRole("img", { name: "Blast radius graph" })).not.toBeInTheDocument();
  });

  it("renders the stats line with de-duped endpoint/cron counts", () => {
    usePrBlastMock.mockReturnValue({ data: SAMPLE_BLAST, isLoading: false });
    renderWithIntl(<BlastTab prId="pr1" repoId="r1" onOpenInDiff={vi.fn()} />);

    expect(screen.getByText("1 symbol · 2 callers · 1 endpoint · 1 cron")).toBeInTheDocument();
  });

  it("hides the prior-PRs section when prior_prs is empty", () => {
    usePrBlastMock.mockReturnValue({ data: SAMPLE_BLAST, isLoading: false });
    renderWithIntl(<BlastTab prId="pr1" repoId="r1" onOpenInDiff={vi.fn()} />);
    expect(screen.queryByText("Prior PRs touching these files")).not.toBeInTheDocument();
  });

  it("shows a collapsed prior-PRs section that expands into links resolving to the number route", () => {
    usePrBlastMock.mockReturnValue({
      data: {
        ...SAMPLE_BLAST,
        prior_prs: [{ id: "pr-42", number: 42, title: "Refactor rate limiting" }],
      },
      isLoading: false,
    });
    renderWithIntl(<BlastTab prId="pr1" repoId="r1" onOpenInDiff={vi.fn()} />);

    expect(screen.getByText("Prior PRs touching these files")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.queryByText("#42 Refactor rate limiting")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Prior PRs touching these files"));

    const link = screen.getByText("#42 Refactor rate limiting");
    expect(link).toBeInTheDocument();
    expect(link.closest("a")).toHaveAttribute("href", "/repos/r1/pulls/42");
  });

  it("the Tree/Graph toggle switches rendered content", () => {
    usePrBlastMock.mockReturnValue({ data: SAMPLE_BLAST, isLoading: false });
    renderWithIntl(<BlastTab prId="pr1" repoId="r1" onOpenInDiff={vi.fn()} />);

    fireEvent.click(screen.getByText("Graph"));
    expect(screen.getByRole("img", { name: "Blast radius graph" })).toBeInTheDocument();
    // Tree-only caller MonoLink (a <button>) is gone once switched to Graph —
    // the Graph SVG renders the same label as plain <text>, not a button.
    expect(screen.queryByRole("button", { name: "src/api/index.ts:23" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Tree"));
    expect(screen.getByRole("button", { name: "src/api/index.ts:23" })).toBeInTheDocument();
  });

  it("clicking a caller in Tree view calls onOpenInDiff", () => {
    const onOpenInDiff = vi.fn();
    usePrBlastMock.mockReturnValue({ data: SAMPLE_BLAST, isLoading: false });
    renderWithIntl(<BlastTab prId="pr1" repoId="r1" onOpenInDiff={onOpenInDiff} />);

    fireEvent.click(screen.getByText("src/api/index.ts:23"));
    expect(onOpenInDiff).toHaveBeenCalledWith("src/api/index.ts", 23);
  });

  it("clicking a caller node in Graph view calls onOpenInDiff", () => {
    const onOpenInDiff = vi.fn();
    usePrBlastMock.mockReturnValue({ data: SAMPLE_BLAST, isLoading: false });
    renderWithIntl(<BlastTab prId="pr1" repoId="r1" onOpenInDiff={onOpenInDiff} />);

    fireEvent.click(screen.getByText("Graph"));
    fireEvent.click(screen.getByText("src/api/index.ts:23"));
    expect(onOpenInDiff).toHaveBeenCalledWith("src/api/index.ts", 23);
  });

  it("Graph view node count matches downstream symbols + total callers + distinct impacts", () => {
    usePrBlastMock.mockReturnValue({ data: SAMPLE_BLAST, isLoading: false });
    const { container } = renderWithIntl(<BlastTab prId="pr1" repoId="r1" onOpenInDiff={vi.fn()} />);

    fireEvent.click(screen.getByText("Graph"));

    // 1 symbol + 2 callers + 2 distinct impacts (1 endpoint + 1 cron) = 5 nodes.
    expect(container.querySelectorAll('[data-blast-node="symbol"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-blast-node="caller"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-blast-node="impact"]')).toHaveLength(2);
  });
});
