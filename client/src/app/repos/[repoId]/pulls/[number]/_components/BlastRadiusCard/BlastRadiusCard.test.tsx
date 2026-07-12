import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/prReview.json";

const usePrBlastMock = vi.fn();
const useSummarizeBlastMock = vi.fn();

vi.mock("@/lib/hooks/blast", () => ({
  usePrBlast: () => usePrBlastMock(),
  useSummarizeBlast: () => useSummarizeBlastMock(),
}));

import { BlastRadiusCard } from "./BlastRadiusCard";

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

describe("BlastRadiusCard", () => {
  it("shows a loading state", () => {
    usePrBlastMock.mockReturnValue({ data: undefined, isLoading: true });
    renderWithIntl(<BlastRadiusCard prId="pr1" repoId="r1" onOpenInDiff={vi.fn()} />);
    expect(screen.getByText("Loading blast radius…")).toBeInTheDocument();
  });

  it("shows an empty state when there are no changed symbols", () => {
    usePrBlastMock.mockReturnValue({
      data: { changed_symbols: [], downstream: [], prior_prs: [], summary: "" },
      isLoading: false,
    });
    renderWithIntl(<BlastRadiusCard prId="pr1" repoId="r1" onOpenInDiff={vi.fn()} />);
    expect(screen.getByText(/No blast radius data/)).toBeInTheDocument();
  });

  it("shows the degraded badge with the reason", () => {
    usePrBlastMock.mockReturnValue({
      data: {
        changed_symbols: [{ name: "rateLimit", file: "src/rl.ts", kind: "function" }],
        downstream: [{ symbol: "rateLimit", callers: [], endpoints_affected: [], crons_affected: [] }],
        prior_prs: [],
        summary: "",
        degraded: true,
        degraded_reason: "index_partial",
      },
      isLoading: false,
    });
    renderWithIntl(<BlastRadiusCard prId="pr1" repoId="r1" onOpenInDiff={vi.fn()} />);
    expect(screen.getByText(/Partial index/)).toBeInTheDocument();
  });

  it("expands a symbol and calls onOpenInDiff when a caller's file:line is clicked", () => {
    const onOpenInDiff = vi.fn();
    usePrBlastMock.mockReturnValue({
      data: {
        changed_symbols: [{ name: "rateLimit", file: "src/rl.ts", kind: "function" }],
        downstream: [
          {
            symbol: "rateLimit",
            callers: [{ name: "handler", file: "src/api/index.ts", line: 23 }],
            endpoints_affected: ["GET /api/items"],
            crons_affected: [],
          },
        ],
        prior_prs: [],
        summary: "",
      },
      isLoading: false,
    });
    renderWithIntl(<BlastRadiusCard prId="pr1" repoId="r1" onOpenInDiff={onOpenInDiff} />);

    fireEvent.click(screen.getByText("rateLimit()"));
    fireEvent.click(screen.getByText("src/api/index.ts:23"));
    expect(onOpenInDiff).toHaveBeenCalledWith("src/api/index.ts", 23);
  });

  it("renders the stats line with de-duped endpoint/cron counts", () => {
    usePrBlastMock.mockReturnValue({
      data: {
        changed_symbols: [
          { name: "rateLimit", file: "src/rl.ts", kind: "function" },
          { name: "otherFn", file: "src/other.ts", kind: "function" },
        ],
        downstream: [
          {
            symbol: "rateLimit",
            callers: [{ name: "handler", file: "src/api/index.ts", line: 23 }],
            endpoints_affected: ["GET /api/items"],
            crons_affected: ["reset-rate-buckets"],
          },
          {
            symbol: "otherFn",
            callers: [{ name: "webhook", file: "src/api/webhooks.ts", line: 45 }],
            endpoints_affected: ["GET /api/items"],
            crons_affected: [],
          },
        ],
        prior_prs: [],
        summary: "",
      },
      isLoading: false,
    });
    renderWithIntl(<BlastRadiusCard prId="pr1" repoId="r1" onOpenInDiff={vi.fn()} />);

    expect(screen.getByText("2 symbols · 2 callers · 1 endpoint · 1 cron")).toBeInTheDocument();
  });

  it("hides the prior-PRs section when prior_prs is empty", () => {
    usePrBlastMock.mockReturnValue({
      data: {
        changed_symbols: [{ name: "rateLimit", file: "src/rl.ts", kind: "function" }],
        downstream: [{ symbol: "rateLimit", callers: [], endpoints_affected: [], crons_affected: [] }],
        prior_prs: [],
        summary: "",
      },
      isLoading: false,
    });
    renderWithIntl(<BlastRadiusCard prId="pr1" repoId="r1" onOpenInDiff={vi.fn()} />);
    expect(screen.queryByText("Prior PRs touching these files")).not.toBeInTheDocument();
  });

  it("shows a collapsed prior-PRs section with a count badge that expands into links on click", () => {
    usePrBlastMock.mockReturnValue({
      data: {
        changed_symbols: [{ name: "rateLimit", file: "src/rl.ts", kind: "function" }],
        downstream: [{ symbol: "rateLimit", callers: [], endpoints_affected: [], crons_affected: [] }],
        prior_prs: [
          { id: "pr-42", number: 42, title: "Refactor rate limiting" },
          { id: "pr-17", number: 17, title: "Add rate buckets" },
        ],
        summary: "",
      },
      isLoading: false,
    });
    renderWithIntl(<BlastRadiusCard prId="pr1" repoId="r1" onOpenInDiff={vi.fn()} />);

    expect(screen.getByText("Prior PRs touching these files")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.queryByText("#42 Refactor rate limiting")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Prior PRs touching these files"));

    const link = screen.getByText("#42 Refactor rate limiting");
    expect(link).toBeInTheDocument();
    expect(link.closest("a")).toHaveAttribute("href", "/repos/r1/pulls/42");
  });
});
