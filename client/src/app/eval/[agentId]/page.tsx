/* Route: /eval/:agentId — per-agent Eval Dashboard (AC-33/AC-34). Thin route
   entry — the view, its fetch/state, styles, constants, helpers and i18n are
   colocated under _components/AgentEvalDashboard, mirroring /agents/[id]. */
"use client";

import { useParams } from "next/navigation";
import { AgentEvalDashboard } from "./_components/AgentEvalDashboard";

export default function AgentEvalDashboardPage() {
  const params = useParams<{ agentId: string }>();
  return <AgentEvalDashboard agentId={params.agentId} />;
}
