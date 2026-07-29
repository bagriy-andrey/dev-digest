/* Route: /eval — workspace Eval Dashboard (AC-35). Thin route entry — the
   view, its fetch/state, styles, constants, helpers and i18n are colocated
   under _components/WorkspaceEvalDashboard, mirroring the /agents route. */
import { WorkspaceEvalDashboard } from "./_components/WorkspaceEvalDashboard";

export default function EvalDashboardPage() {
  return <WorkspaceEvalDashboard />;
}
