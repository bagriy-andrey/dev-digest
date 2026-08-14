import { describe, expect, it } from "vitest";
import { activeKeyFor, isTextInput, toShellRepo } from "./helpers";
import type { Repo } from "../../lib/types";

function repo(overrides: Partial<Repo>): Repo {
  return {
    id: "r1",
    workspace_id: "w1",
    owner: "org",
    name: "repo",
    full_name: "org/repo",
    default_branch: "main",
    clone_path: null,
    last_polled_at: null,
    created_by: null,
    ...overrides,
  };
}

describe("activeKeyFor", () => {
  it.each([
    ["/eval", "eval-dashboard"],
    ["/eval/11111111-1111-1111-1111-111111111111", "eval-dashboard"],
    ["/settings", "settings"],
    ["/agents", "agents"],
    ["/skills", "skills"],
    ["/unknown-route", ""],
  ])("maps %s to %s", (pathname, expected) => {
    expect(activeKeyFor(pathname)).toBe(expected);
  });

  // D4/AC-36 — the NAV item's key (`vendor/ui/nav.ts`) is literally
  // "eval-dashboard"; a near-miss like "eval" would silently break the
  // sidebar highlight (see client/insights.md's nav section).
  it("returns the exact key string the Eval Dashboard NAV entry expects", () => {
    expect(activeKeyFor("/eval")).toBe("eval-dashboard");
    expect(activeKeyFor("/eval")).not.toBe("eval");
  });
});

describe("isTextInput", () => {
  it("returns false for null", () => {
    expect(isTextInput(null)).toBe(false);
  });

  it("returns true for an INPUT element", () => {
    expect(isTextInput(document.createElement("input"))).toBe(true);
  });

  it("returns true for a TEXTAREA element", () => {
    expect(isTextInput(document.createElement("textarea"))).toBe(true);
  });

  it("returns falsy for a non-text element", () => {
    // jsdom's `div.isContentEditable` is `undefined`, not `false` — the
    // implementation's `||` chain then also yields `undefined` (not `false`)
    // for a non-editable, non-input element. Assert falsiness, not strict
    // `=== false`, to avoid coupling this test to that jsdom quirk.
    expect(isTextInput(document.createElement("div"))).toBeFalsy();
  });
});

describe("toShellRepo", () => {
  it("maps a Repo to a RepoSummary, deriving syncedLabel from last_polled_at", () => {
    const synced = toShellRepo(repo({ last_polled_at: "2026-07-29T00:00:00.000Z" }));
    expect(synced.syncedLabel).toBe("synced");

    const notSynced = toShellRepo(repo({ last_polled_at: null }));
    expect(notSynced.syncedLabel).toBe("not synced");
  });
});
