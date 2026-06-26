export const SKILL_TYPE_COLORS: Record<string, string> = {
  rubric: "#3b82f6",
  convention: "#22c55e",
  security: "#ef4444",
  custom: "#6b7280",
};

export const SKILL_TYPE_BG: Record<string, string> = {
  rubric: "rgba(59,130,246,0.15)",
  convention: "rgba(34,197,94,0.15)",
  security: "rgba(239,68,68,0.15)",
  custom: "rgba(107,114,128,0.15)",
};

export const CATEGORY_COLORS: Record<string, string> = {
  security: "#ef4444",
  bug: "#f59e0b",
  perf: "#3b82f6",
  style: "#6b7280",
};

export const DEFAULT_CATEGORY_COLOR = "#9ca3af";

export const DETAIL_TABS = [
  { key: "config", label: "Config" },
  { key: "preview", label: "Preview" },
  { key: "evals", label: "Evals" },
  { key: "stats", label: "Stats" },
  { key: "versions", label: "Versions" },
] as const;
