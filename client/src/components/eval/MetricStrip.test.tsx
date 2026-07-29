import { describe, expect, it, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en/eval.json";
import { MetricStrip } from "./MetricStrip";
import type { MetricStripMetric } from "./MetricStrip";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const passing: MetricStripMetric = { value: 0.92 };

describe("MetricStrip", () => {
  it("renders a percentage for each metric when na is not set", () => {
    renderWithIntl(
      <MetricStrip recall={passing} precision={passing} citation_accuracy={passing} />,
    );
    expect(screen.getAllByText("92%")).toHaveLength(3);
  });

  it("renders the not-applicable marker (not a percentage) when a metric's na flag is set", () => {
    renderWithIntl(
      <MetricStrip
        recall={{ value: 1, na: true }}
        precision={passing}
        citation_accuracy={passing}
      />,
    );
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText("100%")).not.toBeInTheDocument();
    expect(screen.getAllByText("92%")).toHaveLength(2);
  });

  it("resolves the not-applicable marker's accessible label through a message key, not a hard-coded string", () => {
    renderWithIntl(
      <MetricStrip
        recall={{ value: 1, na: true }}
        precision={passing}
        citation_accuracy={passing}
      />,
    );
    expect(screen.getByTitle(messages.common.notApplicable)).toBeInTheDocument();
  });

  it("resolves every metric label through a message key", () => {
    renderWithIntl(
      <MetricStrip recall={passing} precision={passing} citation_accuracy={passing} />,
    );
    expect(screen.getByText(messages.dashboard.metrics.recall)).toBeInTheDocument();
    expect(screen.getByText(messages.dashboard.metrics.precision)).toBeInTheDocument();
    expect(screen.getByText(messages.dashboard.metrics.citationAccuracy)).toBeInTheDocument();
  });
});
