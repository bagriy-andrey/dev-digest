/* BlastGraph — fixed, deterministic 3-column node-link diagram (changed
   symbols -> callers -> impacted endpoints/crons). No physics/force
   simulation and no charting dependency.

   Layout notes (fixed 2026-07-13 — text was overflowing its box and the
   caller column looked chaotic with real, larger PRs):
     - Each node's box WIDTH now fits its (possibly truncated) label instead
       of a fixed column width — `fitLabel` truncates long paths/routes with
       an ellipsis and caps the box at a max width, so text never exceeds its
       box. A `<title>` gives the full string on hover when truncated.
     - Caller nodes are laid out in a BAND per symbol (aligned near that
       symbol's own row), not one global flat-indexed stack — a symbol with
       many callers no longer produces edges radiating from one Y position to
       caller rows scattered far away vertically.
     - A symbol's callers are capped at `MAX_GRAPH_CALLERS_PER_SYMBOL` in the
       graph specifically (independent of the server's own 20-per-symbol cap)
       — the Tree view stays the untruncated source of truth; the graph is a
       diagram, not a list. A "+N more" node closes the band when capped. */
"use client";

import React from "react";
import type { BlastRadiusResult } from "@/lib/types";
import { useTranslations } from "next-intl";
import {
  COL_X,
  ROW_HEIGHT,
  BAND_GAP,
  TOP_PADDING,
  NODE_HEIGHT,
  MAX_GRAPH_CALLERS_PER_SYMBOL,
  FONT_SIZE,
  MAX_BOX_W,
  fitLabel,
} from "./constants";
import { s } from "./styles";

interface BlastGraphProps {
  downstream: BlastRadiusResult["downstream"];
  onOpenInDiff: (file: string, line: number | null) => void;
}

export function BlastGraph({ downstream, onOpenInDiff }: BlastGraphProps) {
  const t = useTranslations("prReview");

  const symbolNodes: { id: string; symbol: string; x: number; y: number; fit: ReturnType<typeof fitLabel> }[] = [];
  const callerNodes: {
    id: string;
    symbol: string;
    file: string;
    line: number;
    x: number;
    y: number;
    fit: ReturnType<typeof fitLabel>;
  }[] = [];
  const moreNodes: { id: string; symbol: string; x: number; y: number; count: number }[] = [];

  let yCursor = TOP_PADDING;
  for (const d of downstream) {
    const shown = d.callers.slice(0, MAX_GRAPH_CALLERS_PER_SYMBOL);
    const hiddenCount = d.callers.length - shown.length;
    const bandTop = yCursor;

    symbolNodes.push({
      id: `symbol:${d.symbol}`,
      symbol: d.symbol,
      x: COL_X.symbol,
      y: bandTop,
      fit: fitLabel(`${d.symbol}()`, FONT_SIZE.symbol, MAX_BOX_W.symbol),
    });

    shown.forEach((c, i) => {
      callerNodes.push({
        id: `caller:${d.symbol}:${c.file}:${c.line}:${i}`,
        symbol: d.symbol,
        file: c.file,
        line: c.line,
        x: COL_X.caller,
        y: bandTop + i * ROW_HEIGHT,
        fit: fitLabel(`${c.file}:${c.line}`, FONT_SIZE.caller, MAX_BOX_W.caller),
      });
    });

    if (hiddenCount > 0) {
      moreNodes.push({
        id: `more:${d.symbol}`,
        symbol: d.symbol,
        x: COL_X.caller,
        y: bandTop + shown.length * ROW_HEIGHT,
        count: hiddenCount,
      });
    }

    const bandRows = Math.max(1, shown.length + (hiddenCount > 0 ? 1 : 0));
    yCursor = bandTop + bandRows * ROW_HEIGHT + BAND_GAP;
  }
  const symbolByName = new Map(symbolNodes.map((n) => [n.symbol, n]));

  const impactMap = new Map<string, { label: string; symbols: Set<string> }>();
  for (const d of downstream) {
    for (const e of d.endpoints_affected) {
      const entry = impactMap.get(e) ?? { label: e, symbols: new Set<string>() };
      entry.symbols.add(d.symbol);
      impactMap.set(e, entry);
    }
    for (const c of d.crons_affected) {
      const key = `cron:${c}`;
      const entry = impactMap.get(key) ?? { label: c, symbols: new Set<string>() };
      entry.symbols.add(d.symbol);
      impactMap.set(key, entry);
    }
  }
  const impactNodes = [...impactMap.entries()].map(([key, v], i) => ({
    id: `impact:${key}`,
    label: v.label,
    symbols: v.symbols,
    x: COL_X.impact,
    y: TOP_PADDING + i * ROW_HEIGHT,
    fit: fitLabel(v.label, FONT_SIZE.impact, MAX_BOX_W.impact),
  }));

  const height = Math.max(yCursor, TOP_PADDING + impactNodes.length * ROW_HEIGHT) + TOP_PADDING;
  const width = COL_X.impact + MAX_BOX_W.impact + 20;

  return (
    <svg
      role="img"
      aria-label="Blast radius graph"
      width="100%"
      viewBox={`0 0 ${width} ${height}`}
      style={s.svg}
    >
      {callerNodes.map((c) => {
        const from = symbolByName.get(c.symbol);
        if (!from) return null;
        return (
          <line
            key={`edge-${c.id}`}
            x1={from.x + from.fit.width}
            y1={from.y}
            x2={c.x}
            y2={c.y}
            style={s.edge}
          />
        );
      })}

      {moreNodes.map((m) => {
        const from = symbolByName.get(m.symbol);
        if (!from) return null;
        return (
          <line
            key={`edge-${m.id}`}
            x1={from.x + from.fit.width}
            y1={from.y}
            x2={m.x}
            y2={m.y}
            style={s.edgeMore}
          />
        );
      })}

      {impactNodes.flatMap((imp) =>
        [...imp.symbols].map((symName) => {
          const from = symbolByName.get(symName);
          if (!from) return null;
          return (
            <line
              key={`edge-${imp.id}-${symName}`}
              x1={from.x + from.fit.width}
              y1={from.y}
              x2={imp.x}
              y2={imp.y}
              style={s.edgeImpact}
            />
          );
        }),
      )}

      {symbolNodes.map((n) => (
        <g key={n.id} data-blast-node="symbol" transform={`translate(${n.x}, ${n.y})`}>
          {n.fit.truncated && <title>{`${n.symbol}()`}</title>}
          <rect x={0} y={-NODE_HEIGHT / 2} width={n.fit.width} height={NODE_HEIGHT} rx={5} style={s.symbolRect} />
          <text x={10} y={5} className="mono" style={s.symbolText}>
            {n.fit.label}
          </text>
        </g>
      ))}

      {callerNodes.map((n) => (
        <g
          key={n.id}
          data-blast-node="caller"
          transform={`translate(${n.x}, ${n.y})`}
          style={s.clickable}
          onClick={() => onOpenInDiff(n.file, n.line)}
        >
          {n.fit.truncated && <title>{`${n.file}:${n.line}`}</title>}
          <rect x={0} y={-NODE_HEIGHT / 2} width={n.fit.width} height={NODE_HEIGHT} rx={5} style={s.callerRect} />
          <text x={10} y={5} className="mono" style={s.callerText}>
            {n.fit.label}
          </text>
        </g>
      ))}

      {moreNodes.map((n) => (
        <g key={n.id} data-blast-node="more" transform={`translate(${n.x}, ${n.y})`}>
          <rect x={0} y={-NODE_HEIGHT / 2} width={160} height={NODE_HEIGHT} rx={5} style={s.moreRect} />
          <text x={10} y={5} className="mono" style={s.moreText}>
            {t("blast.graphMoreCallers", { count: n.count })}
          </text>
        </g>
      ))}

      {impactNodes.map((n) => (
        <g key={n.id} data-blast-node="impact" transform={`translate(${n.x}, ${n.y})`}>
          {n.fit.truncated && <title>{n.label}</title>}
          <rect x={0} y={-NODE_HEIGHT / 2} width={n.fit.width} height={NODE_HEIGHT} rx={5} style={s.impactRect} />
          <text x={10} y={5} className="mono" style={s.impactText}>
            {n.fit.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
