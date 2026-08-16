import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import ciMessages from "../../../../../messages/en/ci.json";
import type { CiTarget } from "@/lib/types";
import { TargetStep, type ConflictInstallation } from "./TargetStep";

afterEach(cleanup);

function Harness({
  initialTarget = "gha" as CiTarget,
  conflict = null as ConflictInstallation | null,
}) {
  const [target, setTarget] = React.useState<CiTarget>(initialTarget);
  const [repo, setRepo] = React.useState("");
  const [confirmReplace, setConfirmReplace] = React.useState(false);
  return (
    <TargetStep
      target={target}
      onTargetChange={setTarget}
      repo={repo}
      onRepoChange={setRepo}
      conflict={conflict}
      confirmReplace={confirmReplace}
      onConfirmReplaceChange={setConfirmReplace}
    />
  );
}

function renderHarness(props: Parameters<typeof Harness>[0] = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ ci: ciMessages }}>
      <Harness {...props} />
    </NextIntlClientProvider>,
  );
}

describe("TargetStep", () => {
  it("renders all four targets with GitHub Actions marked recommended", () => {
    renderHarness();
    expect(screen.getByText(ciMessages.exportWizard.targets.gha)).toBeInTheDocument();
    expect(screen.getByText(ciMessages.exportWizard.targets.circle)).toBeInTheDocument();
    expect(screen.getByText(ciMessages.exportWizard.targets.jenkins)).toBeInTheDocument();
    expect(screen.getByText(ciMessages.exportWizard.targets.cli)).toBeInTheDocument();
    expect(screen.getByText(ciMessages.exportWizard.recommended)).toBeInTheDocument();
  });

  it("selecting a non-GHA target shows the not-available copy", () => {
    renderHarness();
    fireEvent.click(screen.getByText(ciMessages.exportWizard.targets.circle));
    expect(screen.getByText(ciMessages.exportWizard.notAvailableYet)).toBeInTheDocument();
  });

  it("the repo field is a plain free-text input, not a picker", () => {
    renderHarness();
    const input = screen.getByPlaceholderText(ciMessages.exportWizard.repoPlaceholder);
    expect(input.tagName).toBe("INPUT");
    fireEvent.change(input, { target: { value: "acme/payments-api" } });
    expect(screen.getByDisplayValue("acme/payments-api")).toBeInTheDocument();
  });

  it("flags an invalid repo shape inline", () => {
    renderHarness();
    const input = screen.getByPlaceholderText(ciMessages.exportWizard.repoPlaceholder);
    fireEvent.change(input, { target: { value: "not-a-valid-repo" } });
    expect(screen.getByText(ciMessages.exportWizard.repoInvalid)).toBeInTheDocument();
  });

  it("shows the replace warning naming the other agent when a DIFFERENT agent already owns the repo (AC-26a)", () => {
    renderHarness({
      conflict: {
        id: "inst-1",
        agent_id: "agent-other",
        repo: "acme/payments-api",
        target_type: "gha",
        installed_at: "2026-01-01T00:00:00.000Z",
        agent_name: "Other Agent",
      },
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Other Agent");
    expect(screen.getByText(ciMessages.exportWizard.replaceConfirm)).toBeInTheDocument();
  });

  it("does not show a conflict warning when there is none (e.g. same agent re-exporting)", () => {
    renderHarness({ conflict: null });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
