import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import messages from "../../../../../../messages/en/agents.json";
import { ToastProvider } from "../../../../../lib/toast";

// Mock the data hooks so the editor renders without a network/query client.
vi.mock("../../../../../lib/hooks/agents", () => ({
  useUpdateAgent: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false, data: undefined }),
  useProviderModels: () => ({ data: [{ id: "gpt-4.1", provider: "openai" }] }),
}));

// EvalsTab has its own dedicated test suite (EvalsTab/EvalsTab.test.tsx) —
// here we only need a stub to prove AgentEditor's tab switch (constants.ts +
// the render branch) reaches it at all (AC-37's guard).
vi.mock("./_components/EvalsTab", () => ({
  EvalsTab: () => <div data-testid="evals-tab" />,
}));

// CiTab likewise has its own dedicated test suite (CiTab/CiTab.test.tsx) —
// stub it here to prove the CI tab is reachable at all: `page.tsx`'s
// VALID_TABS already allows "ci", so this only passes if BOTH `TABS` (in
// constants.ts) AND this render branch were updated (AC-36's guard, the
// same "key in one allowlist but not the other" failure mode as AC-37).
vi.mock("./_components/CiTab", () => ({
  CiTab: () => <div data-testid="ci-tab" />,
}));

import { AgentEditor } from "./AgentEditor";

afterEach(cleanup);

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

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
      <ToastProvider>{ui}</ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("A2 Agent Editor (smoke)", () => {
  it("renders the Config tab fields", () => {
    renderWithIntl(<AgentEditor agent={AGENT} tab="config" onTab={() => {}} />);
    expect(screen.getByText("Config")).toBeInTheDocument();
    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(screen.getByText("Save agent")).toBeInTheDocument();
  });

  it("renders the Evals tab when opened with ?tab=evals and keeps it selected across re-renders (AC-37)", () => {
    const { rerender } = renderWithIntl(<AgentEditor agent={AGENT} tab="evals" onTab={() => {}} />);
    expect(screen.getByTestId("evals-tab")).toBeInTheDocument();

    // Re-render (e.g. a parent state update) with the same tab prop — the tab
    // must not silently snap back to "config" (the documented failure mode
    // where a key exists in `TABS` but not the render switch, or vice versa).
    rerender(
      <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
        <ToastProvider>
          <AgentEditor agent={AGENT} tab="evals" onTab={() => {}} />
        </ToastProvider>
      </NextIntlClientProvider>,
    );
    expect(screen.getByTestId("evals-tab")).toBeInTheDocument();
    expect(screen.queryByText("Configuration")).not.toBeInTheDocument();
  });

  it("renders the CI tab when opened with ?tab=ci and keeps it selected across re-renders (AC-36)", () => {
    const { rerender } = renderWithIntl(<AgentEditor agent={AGENT} tab="ci" onTab={() => {}} />);
    expect(screen.getByTestId("ci-tab")).toBeInTheDocument();

    rerender(
      <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
        <ToastProvider>
          <AgentEditor agent={AGENT} tab="ci" onTab={() => {}} />
        </ToastProvider>
      </NextIntlClientProvider>,
    );
    expect(screen.getByTestId("ci-tab")).toBeInTheDocument();
    expect(screen.queryByText("Configuration")).not.toBeInTheDocument();
  });
});
