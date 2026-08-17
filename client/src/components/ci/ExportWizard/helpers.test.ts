import { describe, it, expect } from "vitest";
import type { CiFile, CiInstallation } from "@/lib/types";
import {
  editsToOverrideFiles,
  filesToZip,
  findConflictingInstallation,
  isValidRepo,
  isWorkflowFile,
  mergeEdits,
  stepIndex,
} from "./helpers";

describe("isValidRepo", () => {
  it("accepts owner/name", () => {
    expect(isValidRepo("acme/payments-api")).toBe(true);
    expect(isValidRepo(" acme/payments-api ")).toBe(true);
  });
  it("rejects anything else", () => {
    expect(isValidRepo("")).toBe(false);
    expect(isValidRepo("acme")).toBe(false);
    expect(isValidRepo("https://github.com/acme/payments-api")).toBe(false);
    expect(isValidRepo("acme/payments api")).toBe(false);
  });
});

describe("isWorkflowFile", () => {
  it("matches only the generated workflow path shape", () => {
    expect(isWorkflowFile(".github/workflows/devdigest-review.yml")).toBe(true);
    expect(isWorkflowFile(".devdigest/agents/security.yaml")).toBe(false);
    expect(isWorkflowFile(".devdigest/runner/index.js")).toBe(false);
  });
});

describe("stepIndex", () => {
  it("clamps within [0, 3]", () => {
    expect(stepIndex(0, -1)).toBe(0);
    expect(stepIndex(3, 1)).toBe(3);
    expect(stepIndex(1, 1)).toBe(2);
    expect(stepIndex(2, -1)).toBe(1);
  });
});

const WORKFLOW: CiFile = {
  path: ".github/workflows/devdigest-review.yml",
  contents: "name: DevDigest Review",
  editable: true,
};
const RUNNER: CiFile = {
  path: ".devdigest/runner/index.js",
  contents: "/* huge minified bundle */",
  editable: false,
};

describe("mergeEdits", () => {
  it("overrides only editable files with a recorded edit", () => {
    const merged = mergeEdits([WORKFLOW, RUNNER], {
      [WORKFLOW.path]: "name: Edited",
      [RUNNER.path]: "malicious override attempt",
    });
    expect(merged.find((f) => f.path === WORKFLOW.path)?.contents).toBe("name: Edited");
    // The runner bundle can never be overridden, even if `edits` somehow has an entry for it.
    expect(merged.find((f) => f.path === RUNNER.path)?.contents).toBe(RUNNER.contents);
  });

  it("leaves files untouched when there's no edit for them", () => {
    const merged = mergeEdits([WORKFLOW], {});
    expect(merged[0]?.contents).toBe(WORKFLOW.contents);
  });
});

describe("editsToOverrideFiles", () => {
  it("only includes edits matching a generated, editable path", () => {
    const overrides = editsToOverrideFiles([WORKFLOW, RUNNER], {
      [WORKFLOW.path]: "name: Edited",
      [RUNNER.path]: "should be dropped",
      "unknown/path.yml": "should also be dropped",
    });
    expect(overrides).toEqual([{ path: WORKFLOW.path, contents: "name: Edited", editable: true }]);
  });

  it("returns an empty array when nothing was edited", () => {
    expect(editsToOverrideFiles([WORKFLOW, RUNNER], {})).toEqual([]);
  });
});

const INSTALLATION_OTHER_AGENT: CiInstallation & { agent_name?: string | null } = {
  id: "inst-1",
  agent_id: "agent-other",
  repo: "acme/payments-api",
  target_type: "gha",
  installed_at: "2026-01-01T00:00:00.000Z",
  agent_name: "Security Reviewer",
};

describe("findConflictingInstallation", () => {
  it("finds an installation for the SAME repo but a DIFFERENT agent", () => {
    const found = findConflictingInstallation(
      [INSTALLATION_OTHER_AGENT],
      "acme/payments-api",
      "agent-this",
    );
    expect(found?.agent_name).toBe("Security Reviewer");
  });

  it("does not flag the same agent re-exporting to the same repo", () => {
    const found = findConflictingInstallation(
      [INSTALLATION_OTHER_AGENT],
      "acme/payments-api",
      "agent-other",
    );
    expect(found).toBeNull();
  });

  it("returns null for an untyped/empty repo or no matching row", () => {
    expect(findConflictingInstallation([INSTALLATION_OTHER_AGENT], "", "agent-this")).toBeNull();
    expect(
      findConflictingInstallation([INSTALLATION_OTHER_AGENT], "acme/other-repo", "agent-this"),
    ).toBeNull();
    expect(findConflictingInstallation(undefined, "acme/payments-api", "agent-this")).toBeNull();
  });
});

describe("filesToZip", () => {
  it("builds a non-empty zip blob from the given files with no network call", async () => {
    const blob = await filesToZip([WORKFLOW, RUNNER]);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
  });
});
