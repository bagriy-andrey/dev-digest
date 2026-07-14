/** Fixed-column node-link diagram layout. No physics/force simulation — the data is shallow
 *  and bounded, so a deterministic layout is enough (see BlastGraph.tsx's own doc comment). */
export const COL_X = { symbol: 20, caller: 300, impact: 660 } as const;
export const ROW_HEIGHT = 30;
export const BAND_GAP = 10;
export const TOP_PADDING = 20;
export const NODE_HEIGHT = 24;

/** A symbol's caller fan-out is capped IN THE GRAPH specifically (independent of the server's
 *  own `MAX_CALLERS_PER_SYMBOL=20` cap) — 20 boxes radiating from one node is unreadable as a
 *  diagram even though it's fine as a scrollable list (Tree view stays fully untruncated). */
export const MAX_GRAPH_CALLERS_PER_SYMBOL = 6;

export const FONT_SIZE = { symbol: 12, caller: 11, impact: 11 } as const;
/** Rough monospace advance width as a fraction of font-size — good enough for a max-width fit,
 *  not pixel-perfect (actual measurement would need canvas/DOM access at render time). */
const CHAR_WIDTH_RATIO = 0.62;
const BOX_PADDING_X = 20;
export const MIN_BOX_W = 70;
export const MAX_BOX_W = { symbol: 260, caller: 340, impact: 280 } as const;

export interface FitLabel {
  label: string;
  width: number;
  truncated: boolean;
}

/** Truncates `text` (with an ellipsis) if it would exceed `maxWidth` at `fontSize`, and returns
 *  the box width that tightly fits whatever label is actually shown (never wider than
 *  `maxWidth`, never narrower than `MIN_BOX_W`) — this is what fixes text overflowing its box:
 *  the box is sized to the text, and the text is capped to a width the box is allowed to reach. */
export function fitLabel(text: string, fontSize: number, maxWidth: number): FitLabel {
  const charWidth = fontSize * CHAR_WIDTH_RATIO;
  const maxChars = Math.max(3, Math.floor((maxWidth - BOX_PADDING_X) / charWidth));
  if (text.length <= maxChars) {
    return {
      label: text,
      width: Math.max(MIN_BOX_W, Math.ceil(text.length * charWidth) + BOX_PADDING_X),
      truncated: false,
    };
  }
  return { label: `${text.slice(0, maxChars - 1)}…`, width: maxWidth, truncated: true };
}
