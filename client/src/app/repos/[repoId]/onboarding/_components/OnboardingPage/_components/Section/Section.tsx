"use client";

import { Markdown } from "@devdigest/ui";
import { MermaidDiagram } from "@/components/mermaid-diagram/MermaidDiagram";
import type { OnboardingSection as OnboardingSectionData } from "@/lib/types";
import { s } from "../../styles";

/**
 * One onboarding tour section (AC-16): title + markdown body, plus a mermaid
 * diagram when the section carries a non-null `diagram` (only `architecture`/
 * `routes_and_apis` do — enforced server-side, AC-8). Sections render in
 * whatever order the caller passes — the server already guarantees the fixed
 * order, so this component never re-sorts.
 */
export function Section({ section }: { section: OnboardingSectionData }) {
  return (
    <div style={s.section}>
      <div style={s.sectionTitle}>{section.title}</div>
      <Markdown>{section.body}</Markdown>
      {section.diagram && (
        <div style={s.diagramWrap}>
          <MermaidDiagram chart={section.diagram} />
        </div>
      )}
    </div>
  );
}
