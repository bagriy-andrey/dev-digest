import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import ciMessages from "../../../../../messages/en/ci.json";
import { DEFAULT_TRIGGERS, DEFAULT_POST_AS, type PostAsOption } from "../constants";
import { ConfigureStep } from "./ConfigureStep";

afterEach(cleanup);

function Harness() {
  const [triggers, setTriggers] = React.useState<string[]>(DEFAULT_TRIGGERS);
  const [postAs, setPostAs] = React.useState<PostAsOption>(DEFAULT_POST_AS);
  return (
    <ConfigureStep
      triggers={triggers}
      onToggleTrigger={(value, checked) =>
        setTriggers((prev) => (checked ? [...new Set([...prev, value])] : prev.filter((v) => v !== value)))
      }
      postAs={postAs}
      onPostAsChange={setPostAs}
    />
  );
}

function renderHarness() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ ci: ciMessages }}>
      <Harness />
    </NextIntlClientProvider>,
  );
}

function checkboxFor(labelText: string): HTMLElement {
  const label = screen.getByText(labelText).closest("label");
  if (!label) throw new Error(`No <label> ancestor for "${labelText}"`);
  const box = label.querySelector('[role="checkbox"]');
  if (!box) throw new Error(`No checkbox control inside label for "${labelText}"`);
  return box as HTMLElement;
}

describe("ConfigureStep", () => {
  it("renders the three trigger checkboxes with opened+synchronize checked by default, reopened unchecked", () => {
    renderHarness();
    expect(checkboxFor(ciMessages.exportWizard.triggers.opened)).toHaveAttribute("aria-checked", "true");
    expect(checkboxFor(ciMessages.exportWizard.triggers.synchronize)).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(checkboxFor(ciMessages.exportWizard.triggers.reopened)).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("toggling reopened checks it", () => {
    renderHarness();
    const box = checkboxFor(ciMessages.exportWizard.triggers.reopened);
    fireEvent.click(box);
    expect(box).toHaveAttribute("aria-checked", "true");
  });

  it("renders the three post-as options with GitHub review checked by default", () => {
    renderHarness();
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(3);
    expect(radios[0]).toBeChecked(); // github_review, first in POST_AS_OPTIONS
    expect(screen.getByText(ciMessages.exportWizard.postAs.githubReview)).toBeInTheDocument();
    expect(screen.getByText(ciMessages.exportWizard.postAs.prComment)).toBeInTheDocument();
    expect(screen.getByText(ciMessages.exportWizard.postAs.none)).toBeInTheDocument();
  });

  it("renders the two-row secrets table without claiming DevDigest inspected the repo's secrets", () => {
    renderHarness();
    expect(screen.getByText("OPENROUTER_API_KEY")).toBeInTheDocument();
    expect(screen.getByText("GITHUB_TOKEN")).toBeInTheDocument();
    expect(screen.getByText(ciMessages.exportWizard.secretsTable.openrouterManual)).toBeInTheDocument();
    expect(screen.getByText(ciMessages.exportWizard.secretsTable.githubTokenAuto)).toBeInTheDocument();
    expect(screen.queryByText(/inspected/i)).not.toBeInTheDocument();
  });

  it("shows the corrected merge-blocking callout — Fail-CI-on + branch protection, no GitHub App requirement", () => {
    renderHarness();
    expect(screen.getByText(ciMessages.exportWizard.blockMergeDesc)).toBeInTheDocument();
    expect(screen.getByText(ciMessages.exportWizard.blockMergeBody)).toBeInTheDocument();
    // The old (wrong) copy claimed a GitHub App / PAT limitation blocks this feature — gone.
    expect(screen.queryByText(/not available with PAT/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Fail CI on/i)).toBeInTheDocument();
    expect(screen.getByText(/branch protection/i)).toBeInTheDocument();
  });
});
