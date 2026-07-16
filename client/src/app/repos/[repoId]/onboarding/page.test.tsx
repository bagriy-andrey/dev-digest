import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../messages/en/onboarding.json";
import type { Onboarding, OnboardingDoc } from "@/lib/types";

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

// MermaidDiagram itself does an async lazy `import("mermaid")` inside a
// useEffect — irrelevant to this page's own logic, so it's stubbed to a
// simple, synchronously-testable placeholder.
vi.mock("@/components/mermaid-diagram/MermaidDiagram", () => ({
  MermaidDiagram: ({ chart }: { chart: string }) => <div data-testid="mermaid-diagram">{chart}</div>,
}));

const useOnboardingMock = vi.fn();
const useGenerateOnboardingMock = vi.fn();
const useRepoIntelStatusMock = vi.fn();
vi.mock("@/lib/hooks", () => ({
  useOnboarding: (...args: unknown[]) => useOnboardingMock(...args),
  useGenerateOnboarding: (...args: unknown[]) => useGenerateOnboardingMock(...args),
  useRepoIntelStatus: (...args: unknown[]) => useRepoIntelStatusMock(...args),
}));

import OnboardingTourPage from "./page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderWithIntl() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ onboarding: messages }}>
      <OnboardingTourPage />
    </NextIntlClientProvider>,
  );
}

const SECTIONS: Onboarding["sections"] = [
  { kind: "tech_stack", title: "Tech Stack", body: "Uses **TypeScript** and Node.", diagram: null, links: [] },
  {
    kind: "architecture",
    title: "Architecture",
    body: "A layered architecture.",
    diagram: "flowchart LR\n  A --> B",
    links: [],
  },
  { kind: "routes_and_apis", title: "Routes & APIs", body: "GET /repos/:id", diagram: null, links: [] },
  { kind: "reading_path", title: "Reading Path", body: "Start with `index.ts`.", diagram: null, links: [] },
  { kind: "first_tasks", title: "First Tasks", body: "Fix the flaky test.", diagram: null, links: [] },
];

const DOC_LOADED: OnboardingDoc = {
  onboarding: { sections: SECTIONS },
  source_sha: "sha-abc",
  generated_at: new Date().toISOString(),
};

const DOC_EMPTY: OnboardingDoc = { onboarding: null, source_sha: null, generated_at: null };

describe("OnboardingTourPage", () => {
  it("renders an empty state with a Generate CTA when no tour has been generated (AC-17)", () => {
    useOnboardingMock.mockReturnValue({ data: DOC_EMPTY, isLoading: false, isError: false, refetch: vi.fn() });
    useRepoIntelStatusMock.mockReturnValue({ data: undefined });
    useGenerateOnboardingMock.mockReturnValue({ mutate: vi.fn(), isPending: false });

    renderWithIntl();

    expect(screen.getAllByText("Generate onboarding tour").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Generate onboarding tour" })).toBeInTheDocument();
    // No sections and no Regenerate action in the empty state.
    expect(screen.queryByText("Regenerate")).not.toBeInTheDocument();
  });

  it("renders all 5 sections in order, including one with a rendered mermaid diagram (AC-16)", () => {
    useOnboardingMock.mockReturnValue({ data: DOC_LOADED, isLoading: false, isError: false, refetch: vi.fn() });
    useRepoIntelStatusMock.mockReturnValue({ data: { lastIndexedSha: "sha-abc" } });
    useGenerateOnboardingMock.mockReturnValue({ mutate: vi.fn(), isPending: false });

    renderWithIntl();

    const titles = screen.getAllByText(
      /^(Tech Stack|Architecture|Routes & APIs|Reading Path|First Tasks)$/,
    );
    expect(titles.map((el) => el.textContent)).toEqual([
      "Tech Stack",
      "Architecture",
      "Routes & APIs",
      "Reading Path",
      "First Tasks",
    ]);

    // The architecture section's diagram renders via the mocked MermaidDiagram.
    expect(screen.getByTestId("mermaid-diagram")).toHaveTextContent("flowchart LR");

    // Regenerate is shown once a document exists (AC-20).
    expect(screen.getByText("Regenerate")).toBeInTheDocument();
  });

  it("shows a stale indicator when source_sha differs from the current index SHA, and hides it when they match (AC-14)", () => {
    useGenerateOnboardingMock.mockReturnValue({ mutate: vi.fn(), isPending: false });

    // Matching SHAs -> no stale indicator.
    useOnboardingMock.mockReturnValue({ data: DOC_LOADED, isLoading: false, isError: false, refetch: vi.fn() });
    useRepoIntelStatusMock.mockReturnValue({ data: { lastIndexedSha: "sha-abc" } });
    const { unmount } = renderWithIntl();
    expect(screen.queryByText("Stale")).not.toBeInTheDocument();
    unmount();
    cleanup();

    // Diverged SHAs -> stale indicator appears.
    useRepoIntelStatusMock.mockReturnValue({ data: { lastIndexedSha: "sha-xyz" } });
    renderWithIntl();
    expect(screen.getByText("Stale")).toBeInTheDocument();
  });

  it("never renders a cost figure anywhere on the tour screen (AC-15)", () => {
    useOnboardingMock.mockReturnValue({ data: DOC_LOADED, isLoading: false, isError: false, refetch: vi.fn() });
    useRepoIntelStatusMock.mockReturnValue({ data: { lastIndexedSha: "sha-abc" } });
    useGenerateOnboardingMock.mockReturnValue({ mutate: vi.fn(), isPending: false });

    const { container } = renderWithIntl();

    expect(screen.queryByText(/cost/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\$\d/)).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\bcost\b/i);
  });

  it("renders a clickable Copy link button (AC-19)", () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    useOnboardingMock.mockReturnValue({ data: DOC_LOADED, isLoading: false, isError: false, refetch: vi.fn() });
    useRepoIntelStatusMock.mockReturnValue({ data: { lastIndexedSha: "sha-abc" } });
    useGenerateOnboardingMock.mockReturnValue({ mutate: vi.fn(), isPending: false });

    renderWithIntl();

    const copyBtn = screen.getByText("Copy link");
    expect(copyBtn).toBeInTheDocument();
    fireEvent.click(copyBtn);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(window.location.href);
    expect(screen.getByText("Copied!")).toBeInTheDocument();
  });
});
