import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import ciMessages from "../../../../../messages/en/ci.json";
import type { CiFile } from "@/lib/types";
import { InstallStep } from "./InstallStep";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const FILES: CiFile[] = [
  { path: ".devdigest/agents/security-reviewer.yaml", contents: "name: Security Reviewer", editable: true },
  { path: ".devdigest/runner/index.js", contents: "/* runner */", editable: false },
];

function renderInstallStep(overrides: Partial<React.ComponentProps<typeof InstallStep>> = {}) {
  const props: React.ComponentProps<typeof InstallStep> = {
    repo: "acme/payments-api",
    files: FILES,
    edits: {},
    onInstall: vi.fn(),
    isInstalling: false,
    prUrl: null,
    ...overrides,
  };
  return {
    props,
    ...render(
      <NextIntlClientProvider locale="en" messages={{ ci: ciMessages }}>
        <InstallStep {...props} />
      </NextIntlClientProvider>,
    ),
  };
}

describe("InstallStep", () => {
  it("renders both install paths and the docs link", () => {
    renderInstallStep();
    expect(screen.getByText(ciMessages.exportWizard.installCardTitle)).toBeInTheDocument();
    expect(screen.getByText(ciMessages.exportWizard.zipCardTitle)).toBeInTheDocument();
    expect(screen.getByText(ciMessages.exportWizard.docsLink)).toBeInTheDocument();
  });

  it("clicking 'Open a PR' calls onInstall", () => {
    const { props } = renderInstallStep();
    fireEvent.click(screen.getByText(ciMessages.exportWizard.install));
    expect(props.onInstall).toHaveBeenCalledTimes(1);
  });

  it("builds the zip client-side with no additional network call (AC-33)", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    renderInstallStep();
    fireEvent.click(screen.getByText(ciMessages.exportWizard.copyZip));
    await waitFor(() => expect(fetchSpy).not.toHaveBeenCalled());
  });

  it("surfaces the PR URL as the next action once installed (AC-34)", () => {
    renderInstallStep({ prUrl: "https://github.com/acme/payments-api/pull/42" });
    expect(screen.getByText(ciMessages.exportWizard.installedPr)).toBeInTheDocument();
    const link = screen.getByText(ciMessages.exportWizard.viewPr).closest("a");
    expect(link).toHaveAttribute("href", "https://github.com/acme/payments-api/pull/42");
  });

  it("does not show a PR link before installing", () => {
    renderInstallStep();
    expect(screen.queryByText(ciMessages.exportWizard.installedPr)).not.toBeInTheDocument();
  });
});
