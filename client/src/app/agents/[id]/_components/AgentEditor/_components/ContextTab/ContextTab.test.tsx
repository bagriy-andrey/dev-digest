import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import type { ContextAttachment, ContextDoc, ContextFileContent } from "@/lib/types";
import messages from "../../../../../../../../messages/en/agents.json";

// ---- Mocks (static top-level, per client/insights.md's TanStack Query
// mocking guidance — vi.fn() + mockReturnValue per test, no dynamic import). ----

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { id: "repo-1", full_name: "acme/widgets" } }),
}));

const useContextFilesMock = vi.fn();
vi.mock("@/lib/hooks", () => ({
  useContextFiles: (...args: unknown[]) => useContextFilesMock(...args),
}));

const useAgentContextDocsMock = vi.fn();
const useSetAgentContextDocsMock = vi.fn();
const useContextFileMock = vi.fn();
vi.mock("@/lib/hooks/context", () => ({
  useAgentContextDocs: (...args: unknown[]) => useAgentContextDocsMock(...args),
  useSetAgentContextDocs: (...args: unknown[]) => useSetAgentContextDocsMock(...args),
  useContextFile: (...args: unknown[]) => useContextFileMock(...args),
}));

import { ContextTab } from "./ContextTab";

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

const DOCS: ContextDoc[] = [
  { path: "specs/SPEC-01.md", source_type: "specs", size: 400, headings: 3, used_by: 1, coverage: 100 },
  { path: "docs/architecture.md", source_type: "docs", size: 800, headings: 4, used_by: 0, coverage: 0 },
];

const ATTACHMENTS: ContextAttachment[] = [{ path: "specs/SPEC-01.md", order: 0 }];

function renderWithIntl() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
      <ContextTab agent={AGENT} />
    </NextIntlClientProvider>,
  );
}

describe("ContextTab (Agent Editor Screen 2)", () => {
  it("renders a row per discovered doc, attach header badge, and token/footer note", () => {
    useContextFilesMock.mockReturnValue({ data: DOCS, isLoading: false });
    useAgentContextDocsMock.mockReturnValue({ data: ATTACHMENTS, isLoading: false });
    useSetAgentContextDocsMock.mockReturnValue({ mutate: vi.fn() });

    renderWithIntl();

    expect(screen.getByText("SPEC-01.md")).toBeInTheDocument();
    expect(screen.getByText("architecture.md")).toBeInTheDocument();
    expect(screen.getByText("1 of 2 attached")).toBeInTheDocument();

    // token estimate = attached doc sizes / 4 = 400 / 4 = 100
    expect(screen.getByText("~100 tokens (attached docs)")).toBeInTheDocument();
    expect(
      screen.getByText("Injected as an untrusted block (## Project context) into every run."),
    ).toBeInTheDocument();
  });

  it("toggles attach/detach via the checkbox and persists via useSetAgentContextDocs", () => {
    const mutate = vi.fn();
    useContextFilesMock.mockReturnValue({ data: DOCS, isLoading: false });
    useAgentContextDocsMock.mockReturnValue({ data: ATTACHMENTS, isLoading: false });
    useSetAgentContextDocsMock.mockReturnValue({ mutate });

    renderWithIntl();

    const checkboxes = screen.getAllByRole("checkbox");
    // architecture.md (unattached) is the second row (attached-first ordering).
    fireEvent.click(checkboxes[1]!);

    expect(mutate).toHaveBeenCalledWith({
      agentId: "ag1",
      repoId: "repo-1",
      paths: ["specs/SPEC-01.md", "docs/architecture.md"],
    });
  });

  it("opens a view-only preview of the selected doc", () => {
    useContextFilesMock.mockReturnValue({ data: DOCS, isLoading: false });
    useAgentContextDocsMock.mockReturnValue({ data: ATTACHMENTS, isLoading: false });
    useSetAgentContextDocsMock.mockReturnValue({ mutate: vi.fn() });
    const content: ContextFileContent = { path: "specs/SPEC-01.md", content: "# Spec\n\nBody text." };
    useContextFileMock.mockReturnValue({ data: content, isLoading: false, isError: false, refetch: vi.fn() });

    renderWithIntl();

    fireEvent.click(screen.getByLabelText("Preview SPEC-01.md"));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Body text.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("renders an empty state when the active repo has no discovered docs", () => {
    useContextFilesMock.mockReturnValue({ data: [], isLoading: false });
    useAgentContextDocsMock.mockReturnValue({ data: [], isLoading: false });
    useSetAgentContextDocsMock.mockReturnValue({ mutate: vi.fn() });

    renderWithIntl();

    expect(screen.getByText("0 of 0 attached")).toBeInTheDocument();
    expect(screen.getByText(/No documents discovered/)).toBeInTheDocument();
  });
});
