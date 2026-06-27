import type { ConventionCandidate } from "@devdigest/shared";

export function buildSkillBody(name: string, candidates: ConventionCandidate[]): string {
  const header = `# ${name || "Repo Conventions"}\n\nThe following coding conventions were extracted from this repository and validated against source files.\n`;
  const rules = candidates
    .map(
      (c) =>
        `## ${c.rule}\n\n**Evidence:** \`${c.evidence_path}\`\n\n` +
        (c.evidence_snippet ? `\`\`\`\n${c.evidence_snippet}\n\`\`\`` : ""),
    )
    .join("\n\n");
  return `${header}\n${rules}`;
}
