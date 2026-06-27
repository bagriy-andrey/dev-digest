export function buildGithubUrl(
  fullName: string,
  branch: string,
  evidencePath: string | undefined,
  evidenceLine: number | undefined,
): string | null {
  if (!fullName || !evidencePath) return null;
  const base = `https://github.com/${fullName}/blob/${branch || "main"}/${evidencePath}`;
  return evidenceLine != null ? `${base}#L${evidenceLine}` : base;
}

export function truncateSnippet(snippet: string, maxLines = 8): string {
  const lines = snippet.split("\n");
  if (lines.length <= maxLines) return snippet;
  return lines.slice(0, maxLines).join("\n") + `\n…`;
}
