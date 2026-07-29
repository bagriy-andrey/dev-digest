/** Layout constants for the workspace eval dashboard rows/tables. */
export const RECALL_SPARKLINE_WIDTH = 72;
export const RECALL_SPARKLINE_HEIGHT = 22;

/** Skeleton placeholder rows shown while the dashboard is loading. */
export const SKELETON_ROWS = 3;

/** Cap on the flat cross-agent run list rendered under the agent rows — the
 *  server already bounds `recent_runs` (MAX_RECENT_RUNS); this just guards
 *  the client against an unexpectedly large payload. */
export const MAX_VISIBLE_RUNS = 50;
