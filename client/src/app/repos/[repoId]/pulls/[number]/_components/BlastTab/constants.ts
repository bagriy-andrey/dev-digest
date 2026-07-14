/** A symbol with more callers+endpoints+crons than this auto-collapses on first render —
 *  keeps the full (untruncated) Tree view scannable when one shared symbol has many callers,
 *  without hiding any data (every symbol stays individually expandable). */
export const AUTO_COLLAPSE_THRESHOLD = 8;
