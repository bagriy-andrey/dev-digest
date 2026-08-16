import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import ciMessages from "../../../../../messages/en/ci.json";
import type { CiFile } from "@/lib/types";
import { PreviewStep } from "./PreviewStep";

afterEach(cleanup);

const MANIFEST: CiFile = {
  path: ".devdigest/agents/security-reviewer.yaml",
  contents: "name: Security Reviewer",
  editable: true,
};
const SKILL: CiFile = {
  path: ".devdigest/skills/security-rules.md",
  contents: "# Security Rules",
  editable: true,
};
const MEMORY: CiFile = { path: ".devdigest/memory.jsonl", contents: "", editable: true };
const RUNNER: CiFile = {
  path: ".devdigest/runner/index.js",
  contents: "VERY_DISTINCTIVE_MINIFIED_RUNNER_CONTENTS",
  editable: false,
};
const WORKFLOW: CiFile = {
  path: ".github/workflows/devdigest-review.yml",
  contents: "name: DevDigest Review",
  editable: true,
};
const FILES = [MANIFEST, SKILL, MEMORY, RUNNER, WORKFLOW];

function Harness({ initialSelected }: { initialSelected: string }) {
  const [selectedPath, setSelectedPath] = React.useState(initialSelected);
  const [edits, setEdits] = React.useState<Record<string, string>>({});
  return (
    <PreviewStep
      files={FILES}
      edits={edits}
      onEditChange={(path, contents) => setEdits((prev) => ({ ...prev, [path]: contents }))}
      selectedPath={selectedPath}
      onSelectedPathChange={setSelectedPath}
    />
  );
}

function renderHarness(initialSelected = WORKFLOW.path) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ ci: ciMessages }}>
      <Harness initialSelected={initialSelected} />
    </NextIntlClientProvider>,
  );
}

describe("PreviewStep", () => {
  it("lists all five generated file kinds", () => {
    renderHarness();
    for (const f of FILES) {
      // The selected file's path also appears as the code-view's label —
      // assert presence, not uniqueness.
      expect(screen.getAllByText(f.path).length).toBeGreaterThan(0);
    }
  });

  it("shows an editable file's contents in the code view when selected (workflow selected by default)", () => {
    renderHarness(WORKFLOW.path);
    expect(screen.getByDisplayValue(WORKFLOW.contents)).toBeInTheDocument();
  });

  it("never renders the runner bundle's contents, only a not-previewable placeholder", () => {
    renderHarness(RUNNER.path);
    expect(screen.getByText(ciMessages.exportWizard.runnerNotPreviewable)).toBeInTheDocument();
    expect(screen.queryByText(RUNNER.contents)).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue(RUNNER.contents)).not.toBeInTheDocument();
  });

  it("does not mark the runner bundle as editable", () => {
    renderHarness();
    expect(screen.getAllByText(ciMessages.exportWizard.editable)).toHaveLength(
      FILES.filter((f) => f.editable).length,
    );
  });

  it("editing an editable file's contents updates the wizard's edits map", () => {
    renderHarness(WORKFLOW.path);
    const textarea = screen.getByDisplayValue(WORKFLOW.contents);
    fireEvent.change(textarea, { target: { value: "name: Edited Workflow" } });
    expect(screen.getByDisplayValue("name: Edited Workflow")).toBeInTheDocument();
  });
});
