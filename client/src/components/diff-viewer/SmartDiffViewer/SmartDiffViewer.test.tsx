import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrFile, SmartDiff } from "@/lib/types";
import messages from "../../../../messages/en/shell.json";
import { SmartDiffViewer } from "./SmartDiffViewer";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ shell: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const CORE_FILE: PrFile = {
  path: "src/middleware/ratelimit.ts",
  additions: 4,
  deletions: 0,
  patch: "@@ -1,3 +5,3 @@\n+  const count = await redis.incr(key);\n context\n context",
};

const WIRING_FILE: PrFile = {
  path: "src/config.ts",
  additions: 1,
  deletions: 0,
  patch: "@@ -1,1 +1,2 @@\n+  redisUrl: process.env.REDIS_URL,",
};

const BOILERPLATE_FILE: PrFile = {
  path: "package-lock.json",
  additions: 92,
  deletions: 24,
  patch: null,
};

function smartDiff(overrides?: Partial<SmartDiff>): SmartDiff {
  return {
    groups: [
      {
        role: "core",
        files: [
          {
            path: CORE_FILE.path,
            pseudocode_summary: null,
            additions: CORE_FILE.additions,
            deletions: CORE_FILE.deletions,
            finding_lines: [5],
          },
        ],
      },
      {
        role: "wiring",
        files: [
          {
            path: WIRING_FILE.path,
            pseudocode_summary: null,
            additions: WIRING_FILE.additions,
            deletions: WIRING_FILE.deletions,
            finding_lines: [],
          },
        ],
      },
      {
        role: "boilerplate",
        files: [
          {
            path: BOILERPLATE_FILE.path,
            pseudocode_summary: null,
            additions: BOILERPLATE_FILE.additions,
            deletions: BOILERPLATE_FILE.deletions,
            finding_lines: [],
          },
        ],
      },
    ],
    split_suggestion: { too_big: false, total_lines: 0, proposed_splits: [] },
    ...overrides,
  };
}

const FILES = [CORE_FILE, WIRING_FILE, BOILERPLATE_FILE];

describe("SmartDiffViewer", () => {
  it("renders the three sections in core -> wiring -> boilerplate order", () => {
    renderWithIntl(<SmartDiffViewer smartDiff={smartDiff()} files={FILES} />);
    const roles = screen.getAllByText(/Core logic|Wiring|Boilerplate/).map((el) => el.textContent);
    expect(roles).toEqual(["Core logic", "Wiring", "Boilerplate"]);
  });

  it("boilerplate section is collapsed by default while core/wiring are open", () => {
    renderWithIntl(<SmartDiffViewer smartDiff={smartDiff()} files={FILES} />);
    expect(screen.getByText(CORE_FILE.path)).toBeInTheDocument();
    expect(screen.getByText(WIRING_FILE.path)).toBeInTheDocument();
    expect(screen.queryByText(BOILERPLATE_FILE.path)).not.toBeInTheDocument();
  });

  it("a file with findings shows a badge; clicking it expands the card and the anchor id is present", () => {
    renderWithIntl(<SmartDiffViewer smartDiff={smartDiff()} files={FILES} />);
    const badge = screen.getByTitle("1 finding");
    fireEvent.click(badge);
    expect(document.getElementById(`smartdiff-${CORE_FILE.path}:5`)).toBeInTheDocument();
  });

  it("an external target (e.g. from a finding click) expands a collapsed boilerplate section and the file card", () => {
    renderWithIntl(
      <SmartDiffViewer
        smartDiff={smartDiff()}
        files={FILES}
        targetFile={BOILERPLATE_FILE.path}
        targetLine={null}
        targetNonce={1}
      />,
    );
    expect(screen.getByText(BOILERPLATE_FILE.path)).toBeInTheDocument();
    expect(document.getElementById(`filecard-${BOILERPLATE_FILE.path}`)).toBeInTheDocument();
  });

  it("an external target with a line number highlights + anchors that exact line", () => {
    renderWithIntl(
      <SmartDiffViewer
        smartDiff={smartDiff()}
        files={FILES}
        targetFile={WIRING_FILE.path}
        targetLine={1}
        targetNonce={1}
      />,
    );
    expect(document.getElementById(`smartdiff-${WIRING_FILE.path}:1`)).toBeInTheDocument();
  });

  it("does not render a group whose files array is empty", () => {
    const empty = smartDiff({
      groups: [
        {
          role: "core",
          files: [
            {
              path: CORE_FILE.path,
              pseudocode_summary: null,
              additions: CORE_FILE.additions,
              deletions: CORE_FILE.deletions,
              finding_lines: [],
            },
          ],
        },
        { role: "wiring", files: [] },
        { role: "boilerplate", files: [] },
      ],
    });
    renderWithIntl(<SmartDiffViewer smartDiff={empty} files={FILES} />);
    expect(screen.getByText("Core logic")).toBeInTheDocument();
    expect(screen.queryByText("Wiring")).not.toBeInTheDocument();
    expect(screen.queryByText("Boilerplate")).not.toBeInTheDocument();
  });
});
