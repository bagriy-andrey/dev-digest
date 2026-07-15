import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import type { ContextAttachment, ContextDoc, ContextFileContent } from "@/lib/types";
import messages from "../../../../../../../messages/en/skills.json";

// ---- Mocks (static top-level, per client/insights.md's TanStack Query
// mocking guidance — vi.fn() + mockReturnValue per test, no dynamic import). ----

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { id: "repo-1", full_name: "acme/widgets" } }),
}));

const useContextFilesMock = vi.fn();
vi.mock("@/lib/hooks", () => ({
  useContextFiles: (...args: unknown[]) => useContextFilesMock(...args),
}));

const useSkillContextDocsMock = vi.fn();
const useSetSkillContextDocsMock = vi.fn();
const useContextFileMock = vi.fn();
vi.mock("@/lib/hooks/context", () => ({
  useSkillContextDocs: (...args: unknown[]) => useSkillContextDocsMock(...args),
  useSetSkillContextDocs: (...args: unknown[]) => useSetSkillContextDocsMock(...args),
  useContextFile: (...args: unknown[]) => useContextFileMock(...args),
}));

import { ContextTab } from "./ContextTab";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const SKILL: Skill = {
  id: "sk1",
  name: "PR quality rubric",
  description: "Flags style + structure issues",
  type: "rubric",
  source: "manual",
  body: "# Rubric\nBe concise.",
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
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <ContextTab skill={SKILL} />
    </NextIntlClientProvider>,
  );
}

describe("ContextTab (Skill editor Screen 3)", () => {
  it("renders a row per discovered doc, an 'X attached' badge, helper text, and the SERIALIZES AS box", () => {
    useContextFilesMock.mockReturnValue({ data: DOCS, isLoading: false });
    useSkillContextDocsMock.mockReturnValue({ data: ATTACHMENTS, isLoading: false });
    useSetSkillContextDocsMock.mockReturnValue({ mutate: vi.fn() });

    renderWithIntl();

    expect(screen.getByText("SPEC-01.md")).toBeInTheDocument();
    expect(screen.getByText("architecture.md")).toBeInTheDocument();
    expect(screen.getByText("1 attached")).toBeInTheDocument();
    expect(
      screen.getByText("Any agent using this skill inherits these documents."),
    ).toBeInTheDocument();

    expect(screen.getByText("SERIALIZES AS")).toBeInTheDocument();
    expect(screen.getByText("specs/SPEC-01.md")).toBeInTheDocument();
  });

  it("toggles attach/detach via the checkbox and persists via useSetSkillContextDocs", () => {
    const mutate = vi.fn();
    useContextFilesMock.mockReturnValue({ data: DOCS, isLoading: false });
    useSkillContextDocsMock.mockReturnValue({ data: ATTACHMENTS, isLoading: false });
    useSetSkillContextDocsMock.mockReturnValue({ mutate });

    renderWithIntl();

    const checkboxes = screen.getAllByRole("checkbox");
    // architecture.md (unattached) is the second row (attached-first ordering).
    fireEvent.click(checkboxes[1]!);

    expect(mutate).toHaveBeenCalledWith({
      skillId: "sk1",
      repoId: "repo-1",
      paths: ["specs/SPEC-01.md", "docs/architecture.md"],
    });
  });

  it("opens a view-only preview of the selected doc", () => {
    useContextFilesMock.mockReturnValue({ data: DOCS, isLoading: false });
    useSkillContextDocsMock.mockReturnValue({ data: ATTACHMENTS, isLoading: false });
    useSetSkillContextDocsMock.mockReturnValue({ mutate: vi.fn() });
    const content: ContextFileContent = { path: "specs/SPEC-01.md", content: "# Spec\n\nBody text." };
    useContextFileMock.mockReturnValue({ data: content, isLoading: false, isError: false, refetch: vi.fn() });

    renderWithIntl();

    fireEvent.click(screen.getByLabelText("Preview SPEC-01.md"));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Body text.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("renders an empty state and 'no documents attached' when the active repo has no discovered docs", () => {
    useContextFilesMock.mockReturnValue({ data: [], isLoading: false });
    useSkillContextDocsMock.mockReturnValue({ data: [], isLoading: false });
    useSetSkillContextDocsMock.mockReturnValue({ mutate: vi.fn() });

    renderWithIntl();

    expect(screen.getByText("0 attached")).toBeInTheDocument();
    expect(screen.getByText(/No documents discovered/)).toBeInTheDocument();
    expect(screen.getByText("No documents attached — nothing will be injected.")).toBeInTheDocument();
  });
});
