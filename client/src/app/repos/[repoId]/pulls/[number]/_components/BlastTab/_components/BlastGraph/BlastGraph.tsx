/* BlastGraph — fixed, deterministic 3-column node-link diagram (changed
   symbols -> callers -> impacted endpoints/crons). No physics/force
   simulation and no charting dependency — the data is shallow and bounded
   (<=20 callers/symbol), so a fixed column layout is enough. */
"use client";

import React from "react";
import type { BlastRadiusResult } from "@/lib/types";
import { s } from "./styles";

interface BlastGraphProps {
  downstream: BlastRadiusResult["downstream"];
  onOpenInDiff: (file: string, line: number | null) => void;
}

const COL_X = { symbol: 20, caller: 280, impact: 560 } as const;
const SYMBOL_W = 220;
const CALLER_W = 240;
const IMPACT_W = 180;
const ROW_HEIGHT = 32;
const TOP_PADDING = 20;

export function BlastGraph({ downstream, onOpenInDiff }: BlastGraphProps) {
  const symbolNodes = downstream.map((d, i) => ({
    id: `symbol:${d.symbol}`,
    symbol: d.symbol,
    x: COL_X.symbol,
    y: TOP_PADDING + i * ROW_HEIGHT,
  }));
  const symbolByName = new Map(symbolNodes.map((n) => [n.symbol, n]));

  const callerNodes = downstream.flatMap((d) =>
    d.callers.map((c, i) => ({
      id: `caller:${d.symbol}:${c.file}:${c.line}:${i}`,
      symbol: d.symbol,
      file: c.file,
      line: c.line,
      label: `${c.file}:${c.line}`,
    })),
  ).map((n, i) => ({ ...n, x: COL_X.caller, y: TOP_PADDING + i * ROW_HEIGHT }));

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
  }));

  const rows = Math.max(symbolNodes.length, callerNodes.length, impactNodes.length, 1);
  const height = TOP_PADDING * 2 + rows * ROW_HEIGHT;
  const width = COL_X.impact + IMPACT_W + 20;

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
            x1={from.x + SYMBOL_W}
            y1={from.y}
            x2={c.x}
            y2={c.y}
            style={s.edge}
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
              x1={from.x + SYMBOL_W}
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
          <rect x={0} y={-12} width={SYMBOL_W} height={24} rx={5} style={s.symbolRect} />
          <text x={10} y={5} className="mono" style={s.symbolText}>
            {n.symbol}()
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
          <rect x={0} y={-12} width={CALLER_W} height={24} rx={5} style={s.callerRect} />
          <text x={10} y={5} className="mono" style={s.callerText}>
            {n.label}
          </text>
        </g>
      ))}

      {impactNodes.map((n) => (
        <g key={n.id} data-blast-node="impact" transform={`translate(${n.x}, ${n.y})`}>
          <rect x={0} y={-12} width={IMPACT_W} height={24} rx={5} style={s.impactRect} />
          <text x={10} y={5} className="mono" style={s.impactText}>
            {n.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
