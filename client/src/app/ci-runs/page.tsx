/* Route: /ci-runs — ingested CI runs (SPEC-04 §"CI Runs page", AC-40..AC-44).
   Thin route entry — the view, its fetch/state, styles, constants, helpers
   and i18n are colocated under _components/CiRunsPage, mirroring /eval. */
import { CiRunsPage } from "./_components/CiRunsPage";

export default function CiRunsRoute() {
  return <CiRunsPage />;
}
