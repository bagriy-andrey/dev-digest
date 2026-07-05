import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/shell.json";
import type { PrFile, SmartDiff } from "@/lib/types";

const useSmartDiffMock = vi.fn();

vi.mock("@/lib/hooks/reviews", () => ({
  usePrComments: () => ({ data: [] }),
  useCreatePrComment: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/hooks/smart-diff", () => ({
  useSmartDiff: () => useSmartDiffMock(),
}));

import { DiffTab } from "./DiffTab";

afterEach(() => {
  cleanup();
  useSmartDiffMock.mockReset();
});

const FILES: PrFile[] = [
  { path: "src/middleware/ratelimit.ts", additions: 4, deletions: 0, patch: null },
  { path: "package-lock.json", additions: 92, deletions: 24, patch: null },
];

const SMART_DIFF: SmartDiff = {
  groups: [
    {
      role: "core",
      files: [
        {
          path: "src/middleware/ratelimit.ts",
          pseudocode_summary: null,
          additions: 4,
          deletions: 0,
          finding_lines: [],
        },
      ],
    },
    { role: "wiring", files: [] },
    {
      role: "boilerplate",
      files: [
        {
          path: "package-lock.json",
          pseudocode_summary: null,
          additions: 92,
          deletions: 24,
          finding_lines: [],
        },
      ],
    },
  ],
  split_suggestion: { too_big: false, total_lines: 0, proposed_splits: [] },
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ shell: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("DiffTab", () => {
  it("defaults to Smart order and groups files by role", () => {
    useSmartDiffMock.mockReturnValue({ data: SMART_DIFF });
    renderWithIntl(<DiffTab prId="pr1" filesCount={FILES.length} files={FILES} />);
    expect(screen.getByText("Core logic")).toBeInTheDocument();
    expect(screen.getByText("Boilerplate")).toBeInTheDocument();
  });

  it("clicking Original order swaps to the flat DiffViewer", () => {
    useSmartDiffMock.mockReturnValue({ data: SMART_DIFF });
    renderWithIntl(<DiffTab prId="pr1" filesCount={FILES.length} files={FILES} />);
    fireEvent.click(screen.getByText("Original order"));
    expect(screen.queryByText("Core logic")).not.toBeInTheDocument();
    expect(screen.getByText("src/middleware/ratelimit.ts")).toBeInTheDocument();
    expect(screen.getByText("package-lock.json")).toBeInTheDocument();
  });

  it("falls back to the flat viewer while useSmartDiff is loading (data undefined)", () => {
    useSmartDiffMock.mockReturnValue({ data: undefined });
    renderWithIntl(<DiffTab prId="pr1" filesCount={FILES.length} files={FILES} />);
    expect(screen.queryByText("Core logic")).not.toBeInTheDocument();
    expect(screen.getByText("src/middleware/ratelimit.ts")).toBeInTheDocument();
  });
});
