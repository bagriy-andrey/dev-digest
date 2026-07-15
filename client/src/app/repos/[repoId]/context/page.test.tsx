import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../messages/en/context.json";
import type { ContextDoc, ContextFileContent, ContextIndexStatus } from "@/lib/types";

// ---- Mocks (static top-level, per client/insights.md's TanStack Query
// mocking guidance — vi.fn() + mockReturnValue per test, no dynamic import). ----

vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "repo-1" }),
}));

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { id: "repo-1", full_name: "acme/widgets" } }),
  useRepoNotFound: () => false,
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const useContextFilesMock = vi.fn();
const useReindexContextMock = vi.fn();
vi.mock("@/lib/hooks", () => ({
  useContextFiles: (...args: unknown[]) => useContextFilesMock(...args),
  useReindexContext: (...args: unknown[]) => useReindexContextMock(...args),
}));

const useContextFileMock = vi.fn();
vi.mock("@/lib/hooks/context", () => ({
  useContextFile: (...args: unknown[]) => useContextFileMock(...args),
}));

import ProjectContextPage from "./page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderWithIntl() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ context: messages }}>
      <ProjectContextPage />
    </NextIntlClientProvider>,
  );
}

const DOCS: ContextDoc[] = [
  { path: "specs/SPEC-01.md", source_type: "specs", size: 1200, headings: 8, used_by: 2, coverage: 50 },
  { path: "docs/architecture.md", source_type: "docs", size: 800, headings: 4, used_by: 1, coverage: 25 },
];

const FILE_CONTENT: ContextFileContent = { path: "specs/SPEC-01.md", content: "# Spec\n\nBody text." };

const REINDEX_STATUS: ContextIndexStatus = { files: 2, chunks: 12, scanned_at: new Date().toISOString() };

describe("ProjectContextPage (Screen 1)", () => {
  it("lists discovered docs and renders a view-only Markdown preview of the selected doc", () => {
    useContextFilesMock.mockReturnValue({ data: DOCS, isLoading: false, isError: false, refetch: vi.fn() });
    useReindexContextMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useContextFileMock.mockReturnValue({ data: FILE_CONTENT, isLoading: false, isError: false, refetch: vi.fn() });

    renderWithIntl();

    // Left panel lists both docs. "SPEC-01.md" appears twice (list row + the
    // selected-doc preview header title), "architecture.md" only in the list.
    expect(screen.getAllByText("SPEC-01.md").length).toBe(2);
    expect(screen.getByText("architecture.md")).toBeInTheDocument();

    // Right panel: header pills for the first (default-selected) doc.
    expect(screen.getByText("Used by 2 agents")).toBeInTheDocument();
    expect(screen.getByText("COVERAGE 50%")).toBeInTheDocument();

    // Preview body renders the fetched markdown content (view-only, no textarea/edit affordance).
    expect(screen.getByText("Body text.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

    // Footer status bar: counts derived from the doc list (2 files, 12 headings/chunks).
    expect(screen.getByText(/Indexed: 2 files · 12 chunks/)).toBeInTheDocument();
    expect(screen.getByText("Re-index")).toBeInTheDocument();
  });

  it("renders an empty state when the repo has no discovered docs", () => {
    useContextFilesMock.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: vi.fn() });
    useReindexContextMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useContextFileMock.mockReturnValue({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() });

    renderWithIntl();

    expect(screen.getByText("No spec files yet")).toBeInTheDocument();
    expect(screen.getByText(/Indexed: 0 files · 0 chunks/)).toBeInTheDocument();
  });

  it("triggers a reindex via the Re-index button", () => {
    const mutate = vi.fn();
    useContextFilesMock.mockReturnValue({ data: DOCS, isLoading: false, isError: false, refetch: vi.fn() });
    useReindexContextMock.mockReturnValue({ mutate, isPending: false });
    useContextFileMock.mockReturnValue({ data: FILE_CONTENT, isLoading: false, isError: false, refetch: vi.fn() });

    renderWithIntl();
    fireEvent.click(screen.getByText("Re-index"));

    expect(mutate).toHaveBeenCalledWith("repo-1", expect.objectContaining({ onSuccess: expect.any(Function) }));
    // Exercise the onSuccess callback the way the real mutation would.
    act(() => mutate.mock.calls[0]![1].onSuccess(REINDEX_STATUS));
  });
});
